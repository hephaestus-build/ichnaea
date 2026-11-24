import { MeasureCard } from "../contracts/records/measure.js";
import { satisfies } from "./semver.js";
/** Thrown when a configuration cannot load. The message names the plugin. */
export class HostError extends Error {
    /** The error's name, for `instanceof`-free checks. */
    name = "HostError";
}
function register(map, id, value, owner, kind) {
    if (!id.startsWith(`${owner.id}/`))
        throw new HostError(`plugin '${owner.id}': ${kind} '${id}' must be namespaced as '${owner.id}/…'`);
    if (map.has(id))
        throw new HostError(`plugin '${owner.id}': duplicate ${kind} '${id}'`);
    map.set(id, value);
}
const CONFIG_KEYS = new Set([
    "plugins",
    "store",
    "suite",
]);
const PLUGIN_KEYS = new Set([
    "id",
    "version",
    "requires",
    "measures",
    "gates",
    "importers",
]);
function checkFields(value, supported, label) {
    const unknown = Object.keys(value).filter((key) => !supported.has(key));
    if (unknown.length > 0)
        throw new HostError(`${label}: unsupported field(s): ${unknown.join(", ")}`);
}
/** Registers the measure, gate and importer contributions in an explicit configuration. */
export function createHost(config, versions) {
    checkFields(config, CONFIG_KEYS, "configuration");
    const ids = new Set();
    const measures = new Map();
    const gates = new Map();
    const importers = new Map();
    for (const plugin of config.plugins) {
        checkFields(plugin, PLUGIN_KEYS, `plugin '${plugin.id}'`);
        if (!/^[a-z0-9][a-z0-9-]*$/.test(plugin.id))
            throw new HostError(`plugin '${plugin.id}': an ID is lowercase letters, digits and hyphens`);
        if (ids.has(plugin.id))
            throw new HostError(`plugin '${plugin.id}' is listed twice`);
        ids.add(plugin.id);
        for (const [what, range] of Object.entries(plugin.requires ?? {})) {
            const offered = what === "core" ? versions.core : versions.contracts;
            if (range && !satisfies(offered, range))
                throw new HostError(`plugin '${plugin.id}' requires ${what} ${range}, but ${offered} is loaded`);
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
    }
    return { plugins: config.plugins, measures, gates, importers };
}
//# sourceMappingURL=host.js.map