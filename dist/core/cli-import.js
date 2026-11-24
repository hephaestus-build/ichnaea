import { projectForEgress } from "../contracts/egress.js";
import { notComputedReason, TriggerKind } from "../contracts/records/plan.js";
import { Run } from "../contracts/records/run.js";
import { hostAndStore } from "./cli-config.js";
import { CliError, CONFIG_OPTION, many, required, STORE_OPTION, text, } from "./command-grammar.js";
import { importRun } from "./import.js";
import { FileStore } from "./store.js";
import { CORE_VERSION } from "./version.js";
function arm(spec) {
    const [name, role, ...path] = spec.split(":");
    const configuration = path.join(":");
    if (!name || !configuration || (role !== "base" && role !== "candidate" && role !== "reference"))
        throw new CliError("USAGE", `import: --arm '${spec}' is not <name>:<role>:<file>`);
    return { name, role, configuration };
}
export const importCommand = {
    name: "import",
    description: "Import another runner's results into the store (no model calls)",
    options: {
        config: CONFIG_OPTION,
        store: STORE_OPTION,
        importer: { type: "string", description: "Importer ID", required: true },
        plan: { type: "string", description: "Locked analysis plan (instead of inline suite flags)" },
        suite: { type: "string", description: "Suite file (required without --plan)" },
        "case-set": { type: "string", description: "Case set file (required without --plan)" },
        cases: { type: "string", description: "Cases JSONL file (required without --plan)" },
        arm: {
            type: "string",
            description: "Arm as <name>:<role>:<file> (required without --plan)",
            multiple: true,
        },
        file: { type: "string", description: "Input file", multiple: true },
        run: { type: "string", description: "The run ID", required: true },
        trigger: {
            type: "string",
            description: "What changed (default code)",
            choices: TriggerKind.options,
        },
        vary: { type: "string", description: "Factor that the change varies", multiple: true },
        concurrency: { type: "string", description: "Concurrency used by the original runner" },
        endpoint: { type: "string", description: "Endpoint used by the original runner" },
        aa: { type: "string", description: "A decided A/A run to cite", multiple: true },
        seed: { type: "string", description: "Random seed (default 1)" },
        now: { type: "string", description: "Import time (default now)" },
    },
    together: ["concurrency", "endpoint"],
    async run(args, load) {
        const seed = text(args, "seed") ?? "1";
        if (!/^(0|[1-9][0-9]{0,8})$/.test(seed))
            throw new CliError("USAGE", "import: --seed must be a non-negative integer below 10^9");
        const concurrency = text(args, "concurrency");
        if (concurrency !== undefined && !/^[1-9][0-9]{0,5}$/.test(concurrency))
            throw new CliError("USAGE", "import: --concurrency must be a whole number from 1");
        const endpoint = text(args, "endpoint");
        const planPath = text(args, "plan");
        const suite = text(args, "suite");
        const caseSet = text(args, "case-set");
        const cases = text(args, "cases");
        const arms = many(args, "arm");
        const aa = many(args, "aa");
        if (planPath !== undefined && (suite || caseSet || cases || arms.length || aa.length))
            throw new CliError("USAGE", "import: --plan cannot be combined with --suite, --case-set, --cases, --arm or --aa");
        const legacy = suite && caseSet && cases && arms.length
            ? { suite, caseSet, cases, arms: arms.map(arm), aa }
            : undefined;
        if (!planPath && !legacy)
            throw new CliError("USAGE", "import: use --plan or provide --suite, --case-set, --cases and --arm");
        const { host, store, config, directory } = await hostAndStore(args, load);
        const inputs = planPath && config.suite
            ? { locked: { planPath, definition: config.suite, directory } }
            : legacy;
        if (!inputs)
            throw new CliError("CONFIGURATION", "import: the configuration must define the suite used by --plan");
        const run = required(args, "run");
        const result = await importRun({
            host,
            store,
            run,
            importer: required(args, "importer"),
            ...inputs,
            directory,
            files: many(args, "file"),
            trigger: TriggerKind.parse(text(args, "trigger") ?? "code"),
            varies: many(args, "vary"),
            ...(concurrency === undefined || endpoint === undefined
                ? {}
                : { schedule: { concurrency: Number(concurrency), endpoint } }),
            seed: Number(seed),
            now: text(args, "now") ?? new Date().toISOString(),
            ichnaea: CORE_VERSION,
        });
        const reach = (decidable) => !decidable
            ? "cannot decide"
            : result.plan.mode === "decision"
                ? "can decide"
                : "within reach of the margin, but the plan is estimate-only";
        return {
            code: 0,
            text: [
                `import: run ${run}: ${result.trials} trials, ${result.values} values, plan ${result.plan.mode}`,
                ...result.plan.modeReasons.map((reason) => `  estimate-only: ${reason}`),
                ...result.plan.power.map((p) => p.computed
                    ? `  power: ${p.measure}: smallest detectable drop ${(p.mde * 100).toFixed(1)} points (${p.assumption}), margin ${(p.margin * 100).toFixed(1)} points, ${reach(p.decidable)}`
                    : `  power: ${p.measure}: not computed (${notComputedReason(p)})`),
            ],
            json: args.values["json"] === true
                ? projectForEgress(Run, (await new FileStore(store).read(run)).run, {
                    maxClass: "none",
                    purpose: "PU-1",
                }).value
                : undefined,
        };
    },
};
//# sourceMappingURL=cli-import.js.map