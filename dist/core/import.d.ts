import { type Plan } from "../contracts/index.ts";
import type { Host } from "./host.ts";
/** What `ichnaea import` needs. */
export interface ImportRunInput {
    readonly host: Host;
    readonly store: string;
    readonly run: string;
    readonly importer: string;
    readonly suite: string;
    readonly caseSet: string;
    readonly cases: string;
    readonly arms: ReadonlyArray<{
        readonly name: string;
        readonly role: "base" | "candidate" | "reference";
        readonly configuration: string;
    }>;
    readonly files: readonly string[];
    readonly trigger: Plan["trigger"];
    /** Factor keys the change varies beyond what its trigger varies by kind (REQ-15). */
    readonly varies?: readonly string[];
    readonly seed: number;
    readonly now: string;
    readonly ichnaea: string;
}
/**
 * The error kind of a trial whose output was not captured. Such a trial is an infrastructure
 * failure, never a completed trial: it counts as missing, never as a failure of the system.
 */
export declare const NOT_CAPTURED = "not-captured";
/** Thrown when an importer's records cannot be stored. The message names the record. */
export declare class ImportError extends Error {
    readonly name = "ImportError";
}
/**
 * Import mode (REQ-22): resolves the plan, runs an importer over another runner's result files,
 * scores the measures Ichnaea computes, runs the hard gates that have a check, and stores plan,
 * trials, values, gates and the run with its ledger in one atomic write. Every record is checked
 * before anything is written. Import mode makes no model call, so its worst-case calls are zero.
 */
export declare function importRun(input: ImportRunInput): Promise<{
    plan: Plan;
    trials: number;
    values: number;
}>;
//# sourceMappingURL=import.d.ts.map