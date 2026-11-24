var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import { stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { toJsonSchema } from "./contracts/json-schema.js";
import { notComputedReason, TriggerKind } from "./contracts/records/plan.js";
import { RECORD_CONTRACTS } from "./contracts/registry.js";
import { planSuite, readLockedPlan, writeAnalysis } from "./core/analysis-plan.js";
import { decideCommand, reportCommand } from "./core/commands.js";
import { createHost } from "./core/host.js";
import { importRun } from "./core/import.js";
import { testMeasure } from "./core/measures.js";
import { FileStore } from "./core/store.js";
import { blockCalls } from "./plan/analysis.js";
import { resolutionLine } from "./plan/resolution.js";
import { TRIGGER_VARIES } from "./plan/rules.js";
import { CORE_VERSION } from "./core/version.js";
const importModule = (url) => import(__rewriteRelativeImportExtension(url));
/** The Node that Ichnaea needs: it runs the `.ts` sources and configuration with type stripping. */
const NODE_WITHOUT_FLAG = "24.3";
/** Loads `ichnaea.config.ts` (or another file) and returns its default export. */
export async function loadConfig(path, load = importModule) {
    const url = pathToFileURL(resolve(path)).href;
    let module;
    try {
        module = (await load(url));
    }
    catch (error) {
        if (error.code === "ERR_UNKNOWN_FILE_EXTENSION" &&
            extname(path) === ".ts")
            throw new Error(`${path} is TypeScript, and this Node (${process.version}) cannot run it: Ichnaea needs Node ${NODE_WITHOUT_FLAG} or later to load a .ts configuration`, { cause: error });
        throw error;
    }
    if (!module.default || !Array.isArray(module.default.plugins))
        throw new Error(`${path} must export a configuration (defineConfig) as default`);
    return module.default;
}
const IMPORT_OPTIONS = `--importer <id> --plan <plan.json>
Or provide --suite <file> --case-set <file> --cases <file.jsonl> with --arm <name>:<role>:<configuration.json> (repeat)
--file <path> (repeat)
--run <id> [--store .ichnaea] [--trigger code] [--seed 1] [--now <ISO time>]
[--vary <factor key>] (repeat: what the change varies beyond its trigger)
[--concurrency <n> --endpoint <name>] (the schedule the trials ran on)
[--aa <run>] (repeat: a decided A/A run to cite, at one trial per case)`;
const CONFIG_OPTION = {
    type: "string",
    description: "Configuration file (default ichnaea.config.ts)",
};
const HELP_COMMANDS = `Usage: ichnaea <command> [options]

Commands from the core:
  schema <record>     Print the normative JSON Schema of a record (case, trial, decision, ...)
  import              Import another runner's results into the store (no model calls)
                      ${IMPORT_OPTIONS.replaceAll("\n", "\n                      ")}
  plan                Write plan.json and ichnaea.lock beside the suite
  decide              Decide a stored run and write its verdict
  report              Recompute and report a stored decision
  doctor              Check the configuration and its measure testers
  help                Show this help
  --version, -v       Print the version

Options: --config <file> (default ichnaea.config.ts)`;
/**
 * Each trigger and what its arms may differ in, from `TRIGGER_VARIES`, so the help cannot drift
 * from the rule that `decide` applies.
 */
function triggerHelp() {
    const lines = Object.entries(TRIGGER_VARIES).map(([trigger, parts]) => {
        const varies = parts === null
            ? "nothing in the system (--vary is refused)"
            : `${parts.length > 0 ? `the ${parts.join(" and ")} part, and ` : ""}what --vary declares`;
        return `  ${trigger.padEnd(22)}${varies}`;
    });
    return `Triggers (--trigger, default code) and what the arms may differ in:\n${lines.join("\n")}`;
}
const HELP = `${HELP_COMMANDS}\n\n${triggerHelp()}\n\nExit codes: 0 success, 1 a CI policy blocks, 2 an error (usage, configuration or records).`;
const CORE_HELP = new Map([
    [
        "plan",
        "Usage: ichnaea plan [--config <file>] [--frozen] [--pilot <run> --store <directory>]\n\nResolve the suite's analysis plan and lock.",
    ],
    ["schema", "Usage: ichnaea schema <record>\n\nPrint the normative JSON Schema of a record."],
    [
        "doctor",
        `Usage: ichnaea doctor [--config <file>]\n\nCheck plugins, measures and testers.\n${CONFIG_OPTION.description}.`,
    ],
    [
        "import",
        `Usage: ichnaea import [--config <file>] [options]\n\nImport another runner's results into the store.\n\n${IMPORT_OPTIONS}\n\n${triggerHelp()}`,
    ],
]);
const RECORD_COMMANDS = new Map([decideCommand, reportCommand].map((command) => [command.name, command]));
function commandHelp(command) {
    const lines = Object.entries(command.options).map(([name, option]) => {
        const value = option.type === "string" ? " <value>" : "";
        return `  --${name}${value}  ${option.description}`;
    });
    return `Usage: ichnaea ${command.name} [options]\n\n${command.description}\n\nOptions:\n${lines.join("\n")}`;
}
/**
 * Runs the CLI. Returns the exit code: 0 on success, 1 when a command's policy blocks, 2 on any
 * error, so an error never reads as a policy result.
 */
export async function main(argv, out = (t) => process.stdout.write(`${t}\n`), load = importModule, err = (t) => process.stderr.write(`${t}\n`)) {
    try {
        return await dispatch(argv, out, load, err);
    }
    catch (error) {
        err(`error: ${error instanceof Error ? error.message : String(error)}`);
        return 2;
    }
}
async function dispatch(argv, out, load, err) {
    const [command, ...rest] = argv;
    if (!command) {
        err(HELP);
        return 2;
    }
    if (command === "help" || command === "--help") {
        out(HELP);
        return 0;
    }
    if (command === "--version" || command === "-v") {
        out(CORE_VERSION);
        return 0;
    }
    const endOfOptions = rest.indexOf("--");
    const wantsHelp = (endOfOptions < 0 ? rest : rest.slice(0, endOfOptions)).includes("--help");
    const coreHelp = wantsHelp ? CORE_HELP.get(command) : undefined;
    if (coreHelp !== undefined) {
        out(coreHelp);
        return 0;
    }
    if (command === "schema") {
        const name = rest[0];
        const contract = RECORD_CONTRACTS.find((c) => c.name === name);
        if (!contract) {
            err(`unknown record '${name ?? ""}'; one of: ${RECORD_CONTRACTS.map((c) => c.name).join(", ")}`);
            return 2;
        }
        out(JSON.stringify(toJsonSchema(contract), null, 2));
        return 0;
    }
    const recordCommand = RECORD_COMMANDS.get(command);
    if (recordCommand) {
        if (wantsHelp) {
            out(commandHelp(recordCommand));
            return 0;
        }
        const options = { config: CONFIG_OPTION, ...recordCommand.options };
        const { values } = parseArgs({ args: rest, options, strict: true });
        return recordCommand.run(values, { out, err });
    }
    if (command !== "doctor" && command !== "import" && command !== "plan") {
        err(`unknown command '${command}'. Use 'ichnaea help' to list the commands.`);
        return 2;
    }
    const configPath = parseArgs({ args: rest, options: { config: CONFIG_OPTION }, strict: false }).values["config"] ?? "ichnaea.config.ts";
    // A missing file is a usage error with its own message, before any command is looked up.
    const configFile = resolve(configPath);
    if (!(await stat(configFile).then((s) => s.isFile(), () => false))) {
        err(`no ${basename(configFile)} in ${dirname(configFile)}; see the README's quick start`);
        return 2;
    }
    let host;
    let config;
    try {
        config = await loadConfig(configPath, load);
        host = createHost(config, { core: CORE_VERSION, contracts: CORE_VERSION });
    }
    catch (error) {
        err(`configuration error: ${error instanceof Error ? error.message : String(error)}`);
        return 2;
    }
    if (command === "doctor")
        return doctor(host, dirname(configFile), out);
    if (command === "plan") {
        const { values } = parseArgs({
            args: rest,
            options: {
                config: CONFIG_OPTION,
                frozen: { type: "boolean" },
                pilot: { type: "string" },
                store: { type: "string" },
            },
        });
        if (!config.suite) {
            err("plan: the configuration must define a suite");
            return 2;
        }
        const directory = dirname(configFile);
        const prior = values.frozen === true ? await readLockedPlan(join(directory, "plan.json")) : undefined;
        const pilotId = values.pilot ?? prior?.pilot?.run;
        const pilot = pilotId === undefined
            ? undefined
            : await new FileStore(values.store ?? config.store ?? ".ichnaea").read(pilotId);
        const planned = await planSuite({
            ...(pilot === undefined ? {} : { pilot }),
            suite: config.suite,
            host,
            directory,
            ichnaea: CORE_VERSION,
        });
        await writeAnalysis(directory, planned, values.frozen === true);
        const { cases, holm, blocks, replicates } = planned.plan;
        const calls = blockCalls(cases.length, holm.length, blocks, replicates);
        const resolution = planned.plan.resolution?.map((entry) => resolutionLine(entry)).join(" • ");
        out(`plan: ${planned.plan.cases.length} cases, ${planned.plan.blocks} blocks, ${calls} calls${resolution ? ` • ${resolution}` : ""}`);
        return 0;
    }
    return importCommand(host, config, dirname(configFile), rest, out, err);
}
async function doctor(host, directory, out) {
    let problems = 0;
    out(`plugins: ${host.plugins.map((p) => `${p.id}@${p.version}`).join(", ") || "none"}`);
    for (const measure of host.measures.values()) {
        if (measure.card.computedBy === "application") {
            const tester = measure.card.validation?.tester;
            const status = tester?.status;
            out(`measure ${measure.card.id}: computed by the application; tester ${status ?? "not recorded"}`);
            if (tester?.instrumentPin)
                out(`  producer-attested instrument ${tester.instrumentPin}`);
            if (status !== "passed" && measure.card.tier === "primary")
                problems++;
            continue;
        }
        const result = await testMeasure(measure, { directory });
        out(`measure ${measure.card.id}: tester ${result.qualification ?? result.status}`);
        for (const failure of result.failures)
            out(`  ${failure}`);
        if (result.status === "failed")
            problems++;
    }
    out(problems === 0 ? "doctor: clean" : `doctor: ${problems} problem(s)`);
    return problems === 0 ? 0 : 1;
}
async function importCommand(host, config, directory, args, out, err) {
    const { values } = parseArgs({
        args: [...args],
        strict: true,
        options: {
            config: CONFIG_OPTION,
            importer: { type: "string" },
            plan: { type: "string" },
            suite: { type: "string" },
            "case-set": { type: "string" },
            cases: { type: "string" },
            arm: { type: "string", multiple: true },
            file: { type: "string", multiple: true },
            run: { type: "string" },
            store: { type: "string" },
            trigger: { type: "string" },
            vary: { type: "string", multiple: true },
            concurrency: { type: "string" },
            endpoint: { type: "string" },
            aa: { type: "string", multiple: true },
            seed: { type: "string" },
            now: { type: "string" },
        },
    });
    if (!values.importer || !values.run) {
        err("import: --importer and --run are required");
        return 2;
    }
    const locked = values.plan;
    if (locked &&
        (values.suite || values["case-set"] || values.cases || values.arm?.length || values.aa?.length)) {
        err("import: --plan uses the configured suite and arms. Remove the inline suite, case, arm and A/A flags");
        return 2;
    }
    const legacy = locked === undefined && values.suite && values["case-set"] && values.cases && values.arm?.length
        ? { suite: values.suite, caseSet: values["case-set"], cases: values.cases }
        : undefined;
    if (!locked && !legacy) {
        err("import: use --plan or provide --suite, --case-set, --cases and --arm");
        return 2;
    }
    const lockedInputs = locked && config.suite
        ? { locked: { planPath: locked, definition: config.suite, directory } }
        : undefined;
    if (locked && !lockedInputs) {
        err("import: the configuration must define the suite used by --plan");
        return 2;
    }
    const trigger = TriggerKind.safeParse(values.trigger ?? "code");
    if (!trigger.success) {
        err(`import: --trigger must be one of ${TriggerKind.options.join(", ")}`);
        return 2;
    }
    const seed = values.seed ?? "1";
    if (!/^(0|[1-9][0-9]{0,8})$/.test(seed)) {
        err("import: --seed must be a non-negative integer below 10^9");
        return 2;
    }
    if ((values.concurrency === undefined) !== (values.endpoint === undefined)) {
        err("import: --concurrency and --endpoint go together: they state the schedule the trials ran on");
        return 2;
    }
    if (values.concurrency !== undefined && !/^[1-9][0-9]{0,5}$/.test(values.concurrency)) {
        err("import: --concurrency must be a whole number from 1");
        return 2;
    }
    const arms = [];
    for (const spec of values.arm ?? []) {
        const [name, role, ...path] = spec.split(":");
        if (!name || !role || path.length === 0 || !["base", "candidate", "reference"].includes(role)) {
            err(`import: --arm '${spec}' is not <name>:<role>:<file>`);
            return 2;
        }
        arms.push({
            name,
            role: role,
            configuration: path.join(":"),
        });
    }
    const inputs = lockedInputs ?? (legacy === undefined ? undefined : { ...legacy, arms });
    if (!inputs) {
        err("import: missing plan inputs");
        return 2;
    }
    const result = await importRun({
        ...inputs,
        directory,
        host,
        store: values.store ?? ".ichnaea",
        run: values.run,
        importer: values.importer,
        files: values.file ?? [],
        trigger: trigger.data,
        varies: values.vary ?? [],
        ...(values.concurrency === undefined || values.endpoint === undefined
            ? {}
            : { schedule: { concurrency: Number(values.concurrency), endpoint: values.endpoint } }),
        aa: values.aa ?? [],
        seed: Number(seed),
        now: values.now ?? new Date().toISOString(),
        ichnaea: CORE_VERSION,
    });
    out(`import: run ${values.run}: ${result.trials} trials, ${result.values} values, plan ${result.plan.mode}`);
    for (const reason of result.plan.modeReasons)
        out(`  estimate-only: ${reason}`);
    // The planning power statement is resolved before import records are read.
    const reach = (decidable) => !decidable
        ? "cannot decide"
        : result.plan.mode === "decision"
            ? "can decide"
            : "within reach of the margin, but the plan is estimate-only";
    for (const p of result.plan.power)
        out(p.computed
            ? `  power: ${p.measure}: smallest detectable drop ${(p.mde * 100).toFixed(1)} points (${p.assumption}), margin ${(p.margin * 100).toFixed(1)} points, ${reach(p.decidable)}`
            : `  power: ${p.measure}: not computed (${notComputedReason(p)})`);
    return 0;
}
//# sourceMappingURL=cli.js.map