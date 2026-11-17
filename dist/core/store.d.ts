import { type Decision as DecisionRecord, type Plan as PlanRecord, type Run as RunRecord } from "../contracts/index.ts";
import { type RunRecords } from "./records.ts";
/** Thrown when a write would change a record that already exists. */
export declare class AppendOnlyError extends Error {
    /** The error's name, for `instanceof`-free checks. */
    readonly name = "AppendOnlyError";
}
/** Thrown when stored or offered records break the store's rules. The message names the record. */
export declare class StoreError extends Error {
    /** The error's name, for `instanceof`-free checks. */
    readonly name = "StoreError";
}
/** One line of the run index (REQ-28). */
export interface RunIndexEntry {
    /** The run's ID. */
    readonly run: string;
    /** The ID of the suite that the run's plan resolves. */
    readonly suite: string;
    /** The digest of the run's plan. */
    readonly plan: string;
    /** The decision's verdict, or null when the decision gives none. */
    readonly verdict: "PASS" | "REGRESSION" | "INCONCLUSIVE" | "INVALID" | null;
    /** The decision's ISO 8601 timestamp. */
    readonly decidedAt: string;
}
/** Everything stored for one run. */
export interface StoredRun extends RunRecords {
    /** The run's decision; absent until the run is decided. */
    readonly decision?: DecisionRecord;
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
export declare class FileStore {
    /** The store's root directory. */
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
    /**
     * The A/A evidence a plan cites (`plan.aa`): each cited run's decision with its plan and run, in
     * the order cited. A cited run that is not stored, or has no decision, is left out, and `decide`
     * names it.
     */
    aaEvidence(plan: PlanRecord): Promise<{
        decision: DecisionRecord;
        plan: PlanRecord;
        run: RunRecord;
    }[]>;
    /** The run index, oldest first. */
    index(): Promise<RunIndexEntry[]>;
    /** The IDs of stored runs. */
    runs(): Promise<string[]>;
}
//# sourceMappingURL=store.d.ts.map