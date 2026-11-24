import { randomUUID } from "node:crypto";
import { appendFile, link, mkdir, readdir, readFile, rename, rm, writeFile, } from "node:fs/promises";
import { join } from "node:path";
import { canonicalize } from "../contracts/canonical.js";
import { Decision, GateResult, } from "../contracts/records/decision.js";
import { MeasureValue } from "../contracts/records/measure.js";
import { Plan } from "../contracts/records/plan.js";
import { Run } from "../contracts/records/run.js";
import { Trial } from "../contracts/records/trial.js";
import * as z from "zod";
import { recordProblems } from "../contracts/run-records.js";
import { RunManifest } from "../contracts/run-manifest.js";
import { runManifest } from "../report/manifest.js";
import { runDirectory, StoreError } from "./store-path.js";
export { StoreError } from "./store-path.js";
/** Thrown when a write would change a record that already exists. */
export class AppendOnlyError extends Error {
    /** The error's name, for `instanceof`-free checks. */
    name = "AppendOnlyError";
}
const IndexLine = z.strictObject({
    run: z.string().min(1),
    suite: z.string().min(1),
    plan: z.string().min(1),
    verdict: z.enum(["PASS", "REGRESSION", "INCONCLUSIVE", "INVALID"]).nullable(),
    decidedAt: z.string().min(1),
});
function parseLines(text, schema, file) {
    return text.split("\n").flatMap((line, i) => {
        if (line.trim() === "")
            return [];
        let json;
        try {
            json = JSON.parse(line);
        }
        catch (error) {
            throw new StoreError(`${file}:${i + 1}: not JSON (${error.message})`);
        }
        const result = schema.safeParse(json);
        if (!result.success)
            throw new StoreError(`${file}:${i + 1}: invalid record: ${result.error.issues[0]?.message ?? "unknown"}`);
        return [result.data];
    });
}
function parseOne(text, schema, file) {
    const [record, ...rest] = parseLines(text, schema, file);
    if (record === undefined || rest.length > 0)
        throw new StoreError(`${file}: expected exactly one record`);
    return record;
}
async function readOptional(path) {
    try {
        return await readFile(path, "utf8");
    }
    catch (error) {
        if (error.code === "ENOENT")
            return undefined;
        throw error;
    }
}
const lines = (records, schema) => records.map((r) => `${canonicalize(schema.parse(r))}\n`).join("");
/** Publish a complete file once. Retrying an identical write is safe. */
async function publishCanonical(path, value) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    const data = `${canonicalize(value)}\n`;
    try {
        await writeFile(temporary, data, { flag: "wx" });
        await link(temporary, path);
    }
    catch (error) {
        if (error.code !== "EEXIST")
            throw error;
        if ((await readOptional(path)) !== data)
            throw new AppendOnlyError(`record already exists: ${path}`);
    }
    finally {
        await rm(temporary, { force: true });
    }
}
function indexEntry(decision, suite) {
    return IndexLine.parse({
        run: decision.run,
        suite,
        plan: decision.plan,
        verdict: decision.verdict,
        decidedAt: decision.decidedAt,
    });
}
/** Write validated primary records and publish the run in one rename. */
export async function sealRun(root, directory, records, beforePublish) {
    const problems = recordProblems(records);
    if (problems.length > 0)
        throw new StoreError(`run '${records.run.id}': ${problems.join("; ")}`);
    const files = [
        ["plan.json", lines([records.plan], Plan)],
        ["run.json", lines([records.run], Run)],
        ["trials.jsonl", lines(records.trials, Trial)],
        ["values.jsonl", lines(records.values, MeasureValue)],
        ["gates.jsonl", lines(records.gates, GateResult)],
    ];
    const final = runDirectory(root, "runs", records.run.id);
    await mkdir(join(root, "runs"), { recursive: true });
    for (const [name, text] of files)
        await writeFile(join(directory, name), text);
    await beforePublish?.();
    try {
        await rename(directory, final);
    }
    catch (error) {
        const code = error.code;
        if (code === "ENOTEMPTY" || code === "EEXIST" || code === "EISDIR")
            throw new AppendOnlyError(`run '${records.run.id}' already exists; runs are never overwritten`);
        throw error;
    }
}
/**
 * The default store: plain files in an open format (REQ-28). Every record is one RFC 8785
 * canonical JSON line, so files diff cleanly and hash stably. The store is append-only: a run's
 * primary records are written once, together, and never changed; its decision is written once.
 * Every record is validated against its writer schema on write and on read.
 *
 * Layout: `runs/<run>/{plan,run,decision}.json`, `runs/<run>/{trials,values,gates}.jsonl` and an
 * `index.jsonl` with one line per decided run. A run ID becomes a directory name by percent-encoding,
 * so every contract-valid ID is storable and none can leave `runs/`.
 */
export class FileStore {
    /** The store's root directory. */
    root;
    constructor(root) {
        this.root = root;
    }
    dir(run) {
        return runDirectory(this.root, "runs", run);
    }
    /**
     * Writes a run's primary records. They are validated and checked first, then written to a
     * temporary directory that is renamed into place, so a failure leaves no partial run behind.
     */
    async createRun(records) {
        const temporary = join(this.root, "runs", `.incomplete-${randomUUID()}`);
        await mkdir(temporary, { recursive: true });
        try {
            await sealRun(this.root, temporary, records);
        }
        catch (error) {
            await rm(temporary, { recursive: true, force: true });
            throw error;
        }
    }
    /** Stores the decision once and adds the run to the index. */
    async writeDecision(decision, suite) {
        const parsed = Decision.parse(decision);
        const stored = await this.read(parsed.run);
        if (stored.decision)
            throw new AppendOnlyError(`run '${parsed.run}' already has a decision`);
        const manifest = runManifest(stored, parsed, await this.aaEvidence(stored.plan));
        try {
            await writeFile(join(this.dir(parsed.run), "decision.json"), `${canonicalize(parsed)}\n`, {
                flag: "wx",
            });
        }
        catch (error) {
            if (error.code === "EEXIST")
                throw new AppendOnlyError(`run '${parsed.run}' already has a decision`);
            throw error;
        }
        await publishCanonical(join(this.dir(parsed.run), "manifest.json"), manifest);
        await appendFile(join(this.root, "index.jsonl"), `${canonicalize(indexEntry(parsed, suite))}\n`);
    }
    /** Appends a later engine calculation without changing the original files. */
    async writeRecalculation(run, record) {
        const id = record.identity;
        if (record.decision.run !== run || !/^sha256:[0-9a-f]{64}$/.test(id))
            throw new StoreError(`run '${run}': invalid recalculation identity`);
        const directory = join(this.dir(run), "recalculations");
        await mkdir(directory, { recursive: true });
        await publishCanonical(join(directory, `${id.slice("sha256:".length)}.json`), record);
    }
    /** Reads everything stored for a run. Missing primary records are an error, never an empty run. */
    async read(run) {
        const dir = this.dir(run);
        // A run's primary records are written together, an empty list as an empty file, so a missing
        // file is a damaged run, never an empty one.
        const text = async (name) => {
            const found = await readOptional(join(dir, name));
            if (found === undefined)
                throw new StoreError(`run '${run}' has no ${name} in ${dir}`);
            return found;
        };
        const plan = await readOptional(join(dir, "plan.json"));
        const runText = await readOptional(join(dir, "run.json"));
        if (plan === undefined || runText === undefined)
            throw new StoreError(`run '${run}' has no plan or run record in ${dir}`);
        const decision = await readOptional(join(dir, "decision.json"));
        const manifest = await readOptional(join(dir, "manifest.json"));
        const stored = {
            plan: parseOne(plan, Plan, `${run}/plan.json`),
            run: parseOne(runText, Run, `${run}/run.json`),
            trials: parseLines(await text("trials.jsonl"), Trial, `${run}/trials.jsonl`),
            values: parseLines(await text("values.jsonl"), MeasureValue, `${run}/values.jsonl`),
            gates: parseLines(await text("gates.jsonl"), GateResult, `${run}/gates.jsonl`),
            ...(manifest === undefined
                ? {}
                : { manifest: parseOne(manifest, RunManifest, `${run}/manifest.json`) }),
            ...(decision === undefined
                ? {}
                : { decision: parseOne(decision, Decision, `${run}/decision.json`) }),
        };
        const problems = recordProblems(stored);
        if (problems.length > 0)
            throw new StoreError(`run '${run}': ${problems.join("; ")}`);
        return stored;
    }
    /**
     * The A/A evidence a plan cites (`plan.aa`): each cited run's decision with its plan and run, in
     * the order cited. A cited run that is not stored, or has no decision, is left out, and `decide`
     * names it.
     */
    async aaEvidence(plan) {
        const found = [];
        for (const { run } of plan.aa?.decisions ?? []) {
            let stored;
            try {
                stored = await this.read(run);
            }
            catch (error) {
                if (error instanceof StoreError)
                    continue;
                throw error;
            }
            if (stored.decision)
                found.push({ decision: stored.decision, plan: stored.plan, run: stored.run });
        }
        return found;
    }
    /** The run index, oldest first. */
    async index() {
        const entries = parseLines((await readOptional(join(this.root, "index.jsonl"))) ?? "", IndexLine, "index.jsonl");
        const indexed = new Set(entries.map((entry) => entry.run));
        for (const run of await this.runs()) {
            if (indexed.has(run))
                continue;
            const dir = this.dir(run);
            const decision = await readOptional(join(dir, "decision.json"));
            if (decision === undefined)
                continue;
            const plan = parseOne(await readFile(join(dir, "plan.json"), "utf8"), Plan, `${run}/plan.json`);
            entries.push(indexEntry(parseOne(decision, Decision, `${run}/decision.json`), plan.suite));
        }
        return entries.toSorted((a, b) => Date.parse(a.decidedAt) - Date.parse(b.decidedAt));
    }
    /** The IDs of stored runs. */
    async runs() {
        let names;
        try {
            names = await readdir(join(this.root, "runs"));
        }
        catch (error) {
            if (error.code === "ENOENT")
                return [];
            throw error;
        }
        return names
            .filter((n) => !n.startsWith(".incomplete-"))
            .map((n) => decodeURIComponent(n))
            .toSorted();
    }
}
//# sourceMappingURL=store.js.map