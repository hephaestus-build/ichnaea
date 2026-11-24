import { readFile } from "node:fs/promises";
import { digest } from "../contracts/canonical.js";
import { Case, CaseSet } from "../contracts/records/case.js";
import { Configuration } from "../contracts/records/configuration.js";
import { Plan } from "../contracts/records/plan.js";
import { Suite } from "../contracts/records/suite.js";
import { planningPower } from "../plan/power.js";
import { bindImportedPlan } from "./analysis-plan.js";
import { createPlan } from "./planner.js";
import { ImportError, recordRun } from "./record-run.js";
import { FileStore, StoreError } from "./store.js";
export { ImportError, NOT_CAPTURED } from "./record-run.js";
async function json(path) {
    try {
        return JSON.parse(await readFile(path, "utf8"));
    }
    catch (error) {
        throw new ImportError(`${path}: ${error.message}`);
    }
}
/**
 * The plan's citations of decided A/A runs, each by run ID and the digest of its stored decision.
 * A run without a decision cannot be cited.
 */
async function citations(store, runs) {
    if (runs.length === 0)
        return undefined;
    const decisions = [];
    for (const run of runs) {
        let decision;
        try {
            decision = (await store.read(run)).decision;
        }
        catch (error) {
            if (!(error instanceof StoreError))
                throw error;
        }
        if (!decision)
            throw new ImportError(`--aa run '${run}' has no decision in the store; import and decide the A/A run first`);
        decisions.push({ run: decision.run, digest: await digest(decision) });
    }
    return { decisions };
}
async function prepareLegacyImport(input, store) {
    const { host } = input;
    const suite = Suite.parse(await json(input.suite));
    const caseSet = CaseSet.parse(await json(input.caseSet));
    const cases = (await readFile(input.cases, "utf8")).split("\n").flatMap((line, i) => {
        if (line.trim() === "")
            return [];
        let value;
        try {
            value = JSON.parse(line);
        }
        catch (error) {
            throw new ImportError(`${input.cases}:${i + 1}: not JSON (${error.message})`);
        }
        const parsed = Case.safeParse(value);
        if (!parsed.success)
            throw new ImportError(`${input.cases}:${i + 1}: invalid case: ${parsed.error.issues[0]?.message ?? ""}`);
        return [parsed.data];
    });
    const arms = await Promise.all(input.arms.map(async (a) => ({
        name: a.name,
        role: a.role,
        configuration: Configuration.parse(await json(a.configuration)),
    })));
    const aa = await citations(store, input.aa ?? []);
    const draft = await createPlan({
        ...(input.directory === undefined ? {} : { directory: input.directory }),
        suite,
        caseSet,
        cases,
        arms,
        armsToRun: [],
        measures: host.measures,
        gates: host.gates,
        trigger: input.trigger,
        ...(input.varies === undefined ? {} : { varies: input.varies }),
        ...(input.schedule === undefined ? {} : { schedule: input.schedule }),
        ...(aa === undefined ? {} : { aa }),
        seed: input.seed,
        now: input.now,
        ichnaea: input.ichnaea,
    });
    const { refuse, ...power } = planningPower(draft);
    if (refuse !== undefined)
        throw new ImportError(refuse);
    const plan = Plan.parse({ ...draft, ...power });
    return { plan, cases };
}
/**
 * Import mode (REQ-22): resolves the plan, runs an importer over another runner's result files,
 * scores the measures Ichnaea computes, runs the hard gates that have a check, and stores plan,
 * trials, values, gates and the run with its ledger in one atomic write. Every record is checked
 * before anything is written. Import mode makes no model call, so its worst-case calls are zero.
 */
export async function importRun(input) {
    const { host } = input;
    const importer = host.importers.get(input.importer);
    if (!importer)
        throw new ImportError(`no importer '${input.importer}'; the plugins provide: ${[...host.importers.keys()].join(", ") || "none"}`);
    const store = new FileStore(input.store);
    const { plan, cases } = "locked" in input
        ? await bindImportedPlan(input.locked, host, {
            trigger: input.trigger,
            varies: [...(input.varies ?? [])],
            seed: input.seed,
            createdAt: input.now,
            ichnaea: input.ichnaea,
        })
        : await prepareLegacyImport(input, store);
    const result = await importer.run({
        files: input.files,
        plan,
        options: {
            arms: plan.arms.map((a) => ({ name: a.name, identity: a.identity })),
            run: input.run,
        },
    });
    return recordRun({
        host,
        store,
        plan,
        cases,
        result,
        id: input.run,
        execution: { source: "import" },
        startedAt: input.now,
        completedAt: input.now,
        producer: { kind: "plugin", id: importer.id, version: importer.version },
    });
}
//# sourceMappingURL=import.js.map