import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalize } from "../contracts/canonical.js";
import { Decision, GateResult, } from "../contracts/records/decision.js";
import { MeasureValue } from "../contracts/records/measure.js";
import { Plan } from "../contracts/records/plan.js";
import { Run } from "../contracts/records/run.js";
import { Trial } from "../contracts/records/trial.js";
import * as z from "zod";
import { recordProblems } from "./records.js";
/** Thrown when a write would change a record that already exists. */
export class AppendOnlyError extends Error {
    /** The error's name, for `instanceof`-free checks. */
    name = "AppendOnlyError";
}
/** Thrown when stored or offered records break the store's rules. The message names the record. */
export class StoreError extends Error {
    /** The error's name, for `instanceof`-free checks. */
    name = "StoreError";
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
        const name = encodeURIComponent(run);
        if (name === "" || name === "." || name === "..")
            throw new StoreError(`run ID '${run}' cannot name a directory`);
        return join(this.root, "runs", name);
    }
    /**
     * Writes a run's primary records. They are validated and checked first, then written to a
     * temporary directory that is renamed into place, so a failure leaves no partial run behind.
     */
    async createRun(records) {
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
        const final = this.dir(records.run.id);
        const temporary = join(this.root, "runs", `.incomplete-${randomUUID()}`);
        await mkdir(temporary, { recursive: true });
        try {
            for (const [name, text] of files)
                await writeFile(join(temporary, name), text);
            await rename(temporary, final);
        }
        catch (error) {
            await rm(temporary, { recursive: true, force: true });
            const code = error.code;
            if (code === "ENOTEMPTY" || code === "EEXIST" || code === "EISDIR")
                throw new AppendOnlyError(`run '${records.run.id}' already exists; runs are never overwritten`);
            throw error;
        }
    }
    /** Stores the decision once and adds the run to the index. */
    async writeDecision(decision, suite) {
        const parsed = Decision.parse(decision);
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
        const entry = IndexLine.parse({
            run: parsed.run,
            suite,
            plan: parsed.plan,
            verdict: parsed.verdict,
            decidedAt: parsed.decidedAt,
        });
        await appendFile(join(this.root, "index.jsonl"), `${canonicalize(entry)}\n`);
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
        const stored = {
            plan: parseOne(plan, Plan, `${run}/plan.json`),
            run: parseOne(runText, Run, `${run}/run.json`),
            trials: parseLines(await text("trials.jsonl"), Trial, `${run}/trials.jsonl`),
            values: parseLines(await text("values.jsonl"), MeasureValue, `${run}/values.jsonl`),
            gates: parseLines(await text("gates.jsonl"), GateResult, `${run}/gates.jsonl`),
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
        return parseLines((await readOptional(join(this.root, "index.jsonl"))) ?? "", IndexLine, "index.jsonl");
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