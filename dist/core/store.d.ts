import { type Decision as DecisionRecord, type GateResult as GateResultRecord, type MeasureValue as MeasureValueRecord, type Plan as PlanRecord, type Run as RunRecord, type Trial as TrialRecord } from "../contracts/index.ts";
/** Thrown when a write would change a record that already exists. */
export declare class AppendOnlyError extends Error {
    readonly name = "AppendOnlyError";
}
/** Thrown when stored or offered records break the store's rules. The message names the record. */
export declare class StoreError extends Error {
    readonly name = "StoreError";
}
/** One line of the run index (REQ-28). */
export interface RunIndexEntry {
    readonly run: string;
    readonly suite: string;
    readonly plan: string;
    readonly verdict: "PASS" | "REGRESSION" | "INCONCLUSIVE" | "INVALID" | null;
    readonly decidedAt: string;
}
/** The primary records of one run, written together. */
export interface RunRecords {
    readonly plan: PlanRecord;
    readonly run: RunRecord;
    readonly trials: readonly TrialRecord[];
    readonly values: readonly MeasureValueRecord[];
    readonly gates: readonly GateResultRecord[];
}
/** Everything stored for one run. */
export interface StoredRun extends RunRecords {
    readonly decision?: DecisionRecord;
}
/**
 * The rules every set of run records keeps: one record per trial, one value per measure and trial,
 * one result per gate. A second record would silently replace the first in any lookup, so it could
 * hide a regression. Returns one message per broken rule.
 */
export declare function recordProblems(records: Omit<RunRecords, "plan" | "run">): string[];
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
export declare class FileStore {
    readonly root: string;
    constructor(root: string);
    private dir;
    /**
     * Writes a run's primary records. They are validated and checked first, then written to a
     * temporary directory that is renamed into place, so a failure leaves no partial run behind.
     */
    createRun(records: RunRecords): Promise<void>;
    /** Stores the decision once and adds the run to the index. */
    writeDecision(decision: DecisionRecord, suite: string): Promise<void>;
    /** Reads everything stored for a run. Missing primary records are an error, never an empty run. */
    read(run: string): Promise<StoredRun>;
    /** The run index, oldest first. */
    index(): Promise<RunIndexEntry[]>;
    /** The IDs of stored runs. */
    runs(): Promise<string[]>;
}
//# sourceMappingURL=store.d.ts.map