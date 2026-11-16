import { MeasureCard, Plan } from "../contracts/index.js";
import { satisfies } from "./semver.js";
/** Thrown when a configuration cannot load. The message names the plugin. */
export class HostError extends Error {
    name = "HostError";
}
function rank(p) {
    return p.placement === "pre" ? 0 : p.placement === "post" ? 2 : 1;
}
function ordered(plugins) {
    return plugins.toSorted((a, b) => rank(a) - rank(b));
}
/** Commands the core defines; a plugin cannot replace them. */
export const CORE_COMMANDS = ["help", "schema", "doctor", "import"];
function register(map, id, value, owner, kind) {
    if (!id.startsWith(`${owner.id}/`))
        throw new HostError(`plugin '${owner.id}': ${kind} '${id}' must be namespaced as '${owner.id}/…'`);
    if (map.has(id))
        throw new HostError(`plugin '${owner.id}': duplicate ${kind} '${id}'`);
    map.set(id, value);
}
/**
 * Loads a configuration (REQ-80): plugins are listed explicitly, IDs are unique and namespaced,
 * peer ranges and stability opt-ins are checked, and every conflict fails at load time naming the
 * plugin. Deprecated plugins load with a warning that names the replacement.
 */
export function createHost(config, versions, log = () => undefined) {
    const warnings = [];
    const allowed = new Set(["stable", ...(config.allowStability ?? [])]);
    const ids = new Set();
    const measures = new Map();
    const gates = new Map();
    const importers = new Map();
    const commands = new Map();
    for (const plugin of config.plugins) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(plugin.id))
            throw new HostError(`plugin '${plugin.id}': an ID is lowercase letters, digits and hyphens`);
        if (ids.has(plugin.id))
            throw new HostError(`plugin '${plugin.id}' is listed twice`);
        ids.add(plugin.id);
        if (!allowed.has(plugin.stability)) {
            throw new HostError(`plugin '${plugin.id}' is ${plugin.stability}; add '${plugin.stability}' to allowStability to use it`);
        }
        for (const [what, range] of Object.entries(plugin.requires ?? {})) {
            const offered = what === "core" ? versions.core : versions.contracts;
            if (range && !satisfies(offered, range))
                throw new HostError(`plugin '${plugin.id}' requires ${what} ${range}, but ${offered} is loaded`);
        }
        if (plugin.deprecated) {
            warnings.push(`plugin '${plugin.id}' is deprecated since ${plugin.deprecated.since} and is removed in ${plugin.deprecated.removeIn}; use ${plugin.deprecated.replacement} (${plugin.deprecated.url})`);
        }
        for (const m of plugin.measures ?? []) {
            if (!m.card)
                throw new HostError(`plugin '${plugin.id}': a measure has no card`);
            const card = MeasureCard.safeParse({ schema: "ichnaea.measureCard/1", ...m.card });
            if (!card.success)
                throw new HostError(`plugin '${plugin.id}': the card of measure '${m.card.id}' is invalid: ${card.error.issues[0]?.path.join(".") ?? ""} ${card.error.issues[0]?.message ?? ""}`);
            register(measures, m.card.id, m, plugin, "measure");
        }
        for (const g of plugin.gates ?? [])
            register(gates, g.id, g, plugin, "gate");
        for (const i of plugin.importers ?? [])
            register(importers, i.id, i, plugin, "importer");
        for (const c of plugin.commands ?? []) {
            if (CORE_COMMANDS.includes(c.name))
                throw new HostError(`plugin '${plugin.id}': command '${c.name}' is a core command`);
            if (commands.has(c.name))
                throw new HostError(`plugin '${plugin.id}': command '${c.name}' is already defined`);
            commands.set(c.name, c);
        }
    }
    if (config.governance !== undefined && !ids.has(config.governance))
        throw new HostError(`governance names plugin '${config.governance}', which the configuration does not list`);
    for (const warning of warnings)
        log(warning);
    const plugins = ordered(config.plugins);
    const ctx = { log };
    const withHook = (name) => plugins.flatMap((p) => (p.hooks?.[name] ? [[p, p.hooks[name]]] : []));
    return {
        plugins,
        measures,
        gates,
        importers,
        commands,
        warnings,
        async configResolved() {
            for (const [, hook] of withHook("configResolved"))
                await hook(ctx);
        },
        async trialRecorded(trial) {
            await Promise.all(withHook("trialRecorded").map(([, hook]) => hook(ctx, trial)));
        },
        async runCompleted(run) {
            for (const [, hook] of withHook("runCompleted"))
                await hook(ctx, run);
        },
        async planCreated(plan) {
            let current = plan;
            for (const [plugin, hook] of withHook("planCreated")) {
                const additions = await hook(ctx, current);
                if (!additions)
                    continue;
                if (additions.refuse)
                    throw new HostError(`plugin '${plugin.id}' refused the plan: ${additions.refuse}`);
                const { refuse: _refuse, ...rest } = additions;
                if (rest.mode === "decision" && current.mode !== "decision")
                    throw new HostError(`plugin '${plugin.id}' cannot turn an estimate-only plan into a decision`);
                current = Plan.parse({ ...current, ...rest });
            }
            return current;
        },
        async decisionMade(decision) {
            await Promise.all(withHook("decisionMade").map(([, hook]) => hook(ctx, decision)));
        },
        async reportRendered(files) {
            await Promise.all(withHook("reportRendered").map(([, hook]) => hook(ctx, files)));
        },
        async beforeEgress(request) {
            return decideEgress(request, withHook("beforeEgress"), ctx, config.governance);
        },
    };
}
/**
 * Runs the `beforeEgress` hooks in order (REQ-126). Any plugin can refuse, and the first refusal
 * wins. Without an explicit allow from the governance plugin that the configuration names, only
 * data classed `none` may leave: default deny. An allow from any other plugin counts for nothing.
 */
export async function decideEgress(request, hooks, ctx, governance) {
    let allowedByPlugin = false;
    for (const [plugin, hook] of hooks) {
        const answer = await hook(ctx, request);
        if (answer && !answer.allow) {
            const reason = `${plugin.id}: ${answer.reason}`;
            ctx.log(`egress refused (${request.operation}, ${request.purpose}, ${request.dataClass} -> ${request.destination}): ${reason}`);
            return { allow: false, reasons: [reason] };
        }
        if (answer?.allow && governance !== undefined && plugin.id === governance)
            allowedByPlugin = true;
        else if (answer?.allow)
            ctx.log(`egress: plugin '${plugin.id}' is not a governance plugin, so its allow is ignored`);
    }
    if (request.dataClass === "none" || allowedByPlugin)
        return { allow: true, reasons: [] };
    const reason = `default deny: data classed '${request.dataClass}' leaves only when a governance plugin allows it`;
    ctx.log(`egress refused (${request.operation}, ${request.purpose} -> ${request.destination}): ${reason}`);
    return { allow: false, reasons: [reason] };
}
//# sourceMappingURL=host.js.map