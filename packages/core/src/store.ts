import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  canonicalize,
  Decision,
  type Decision as DecisionRecord,
  GateResult,
  type GateResult as GateResultRecord,
  MeasureValue,
  type MeasureValue as MeasureValueRecord,
  Plan,
  type Plan as PlanRecord,
  Run,
  type Run as RunRecord,
  Trial,
  type Trial as TrialRecord,
} from "@hephaestus-build/ichnaea-contracts";
import type * as z from "zod";

/** Thrown when a write would change a record that already exists. */
export class AppendOnlyError extends Error {
  override readonly name = "AppendOnlyError";
}

/** One line of the run index (REQ-28). */
export interface RunIndexEntry {
  readonly run: string;
  readonly suite: string;
  readonly plan: string;
  readonly verdict: string | null;
  readonly decidedAt: string;
}

/** Everything stored for one run. */
export interface StoredRun {
  readonly plan: PlanRecord;
  readonly run: RunRecord;
  readonly trials: readonly TrialRecord[];
  readonly values: readonly MeasureValueRecord[];
  readonly gates: readonly GateResultRecord[];
  readonly decision?: DecisionRecord;
}

function parseLines<T>(text: string, schema: z.ZodType<T>, file: string): T[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, i) => {
      const result = schema.safeParse(JSON.parse(line));
      if (!result.success)
        throw new Error(
          `${file}:${i + 1}: invalid record: ${result.error.issues[0]?.message ?? "unknown"}`,
        );
      return result.data;
    });
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * The default store: plain files in an open format (REQ-28). Every record is one RFC 8785
 * canonical JSON line, so files diff cleanly and hash stably. The store is append-only: a single
 * record file is created once and never overwritten, and lists only grow. Every record is
 * validated against its writer schema on write and on read.
 *
 * Layout: `runs/<run>/{plan,run,decision}.json`, `runs/<run>/{trials,values,gates}.jsonl` and an
 * `index.jsonl` with one line per decided run.
 */
export class FileStore {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  private dir(run: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._@+-]*$/.test(run))
      throw new Error(`run ID '${run}' cannot name a directory`);
    return join(this.root, "runs", run);
  }

  private async writeOnce<T>(
    run: string,
    name: string,
    schema: z.ZodType<T>,
    record: T,
  ): Promise<void> {
    const parsed = schema.parse(record);
    await mkdir(this.dir(run), { recursive: true });
    try {
      await writeFile(join(this.dir(run), name), `${canonicalize(parsed)}\n`, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new AppendOnlyError(`${run}/${name} already exists; records are never overwritten`);
      throw error;
    }
  }

  private async append<T>(
    run: string,
    name: string,
    schema: z.ZodType<T>,
    records: readonly T[],
  ): Promise<void> {
    if (records.length === 0) return;
    const lines = records.map((r) => canonicalize(schema.parse(r))).join("\n");
    await mkdir(this.dir(run), { recursive: true });
    await appendFile(join(this.dir(run), name), `${lines}\n`);
  }

  /** Stores the locked plan of a run. */
  writePlan(run: string, plan: PlanRecord): Promise<void> {
    return this.writeOnce(run, "plan.json", Plan, plan);
  }

  /** Appends trial records. */
  appendTrials(run: string, trials: readonly TrialRecord[]): Promise<void> {
    return this.append(run, "trials.jsonl", Trial, trials);
  }

  /** Appends measure values. */
  appendValues(run: string, values: readonly MeasureValueRecord[]): Promise<void> {
    return this.append(run, "values.jsonl", MeasureValue, values);
  }

  /** Appends hard-gate results. */
  appendGates(run: string, gates: readonly GateResultRecord[]): Promise<void> {
    return this.append(run, "gates.jsonl", GateResult, gates);
  }

  /** Stores the completed run record with its ledger. */
  writeRun(run: RunRecord): Promise<void> {
    return this.writeOnce(run.id, "run.json", Run, run);
  }

  /** Stores the decision and adds the run to the index. */
  async writeDecision(decision: DecisionRecord, suite: string): Promise<void> {
    await this.writeOnce(decision.run, "decision.json", Decision, decision);
    const entry: RunIndexEntry = {
      run: decision.run,
      suite,
      plan: decision.plan,
      verdict: decision.verdict,
      decidedAt: decision.decidedAt,
    };
    await mkdir(this.root, { recursive: true });
    await appendFile(join(this.root, "index.jsonl"), `${canonicalize(entry)}\n`);
  }

  /** Reads everything stored for a run. Missing primary records are an error, never an empty run. */
  async read(run: string): Promise<StoredRun> {
    const dir = this.dir(run);
    const plan = await readOptional(join(dir, "plan.json"));
    const runText = await readOptional(join(dir, "run.json"));
    if (plan === undefined || runText === undefined)
      throw new Error(`run '${run}' has no plan or run record in ${dir}`);
    const decision = await readOptional(join(dir, "decision.json"));
    return {
      plan: Plan.parse(JSON.parse(plan)),
      run: Run.parse(JSON.parse(runText)),
      trials: parseLines(
        (await readOptional(join(dir, "trials.jsonl"))) ?? "",
        Trial,
        "trials.jsonl",
      ),
      values: parseLines(
        (await readOptional(join(dir, "values.jsonl"))) ?? "",
        MeasureValue,
        "values.jsonl",
      ),
      gates: parseLines(
        (await readOptional(join(dir, "gates.jsonl"))) ?? "",
        GateResult,
        "gates.jsonl",
      ),
      ...(decision === undefined ? {} : { decision: Decision.parse(JSON.parse(decision)) }),
    };
  }

  /** The run index, oldest first. */
  async index(): Promise<RunIndexEntry[]> {
    const text = (await readOptional(join(this.root, "index.jsonl"))) ?? "";
    return text
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as RunIndexEntry);
  }

  /** The IDs of stored runs. */
  async runs(): Promise<string[]> {
    try {
      return (await readdir(join(this.root, "runs"))).toSorted();
    } catch {
      return [];
    }
  }
}
