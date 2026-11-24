import { Plan } from "../contracts/records/plan.ts";
import { type LockedImport } from "./analysis-plan.ts";
import type { Host } from "./host.ts";
export { ImportError, NOT_CAPTURED } from "./record-run.ts";
/** What `ichnaea import` needs. */
interface ImportRunOptions {
    /** The loaded configuration that provides the importer, measures and gates. */
    readonly host: Host;
    /** Directory of declared scorer files for imports using the inline flags. */
    readonly directory?: string;
    /** The directory of the file store that the run is written to. */
    readonly store: string;
    /** The ID of the run to create. */
    readonly run: string;
    /** The ID of the importer that reads the result files. */
    readonly importer: string;
    /** The other runner's result files that the importer reads. */
    readonly files: readonly string[];
    /** The kind of change that the run evaluates. */
    readonly trigger: Plan["trigger"];
    /** Factor keys the change varies beyond what its trigger varies by kind (REQ-15). */
    readonly varies?: readonly string[];
    /** The schedule the trials ran on: how many ran at once, and the endpoint they called. */
    readonly schedule?: Plan["schedule"];
    /** Decided A/A runs in the store that the plan cites, by run ID (one trial per case). */
    readonly aa?: readonly string[];
    /** The plan's seed, a non-negative integer. */
    readonly seed: number;
    /** The ISO 8601 timestamp recorded as the plan's creation and the run's start and end. */
    readonly now: string;
    /**
     * The Ichnaea version, a semantic version, recorded in the plan, the run's environment and its
     * lineage.
     */
    readonly ichnaea: string;
}
/** Resolve inputs from the locked analysis or from the original inline flags. */
export type ImportRunInput = ImportRunOptions & ({
    readonly locked: LockedImport;
} | LegacyInputs);
interface LegacyInputs {
    /** The path of the suite's JSON file. */
    readonly suite: string;
    /** The path of the case set's JSON file. */
    readonly caseSet: string;
    /** The path of the cases' JSON Lines file, one case per line; blank lines are skipped. */
    readonly cases: string;
    /** The arms, each with its name, role and the path of its configuration's JSON file. */
    readonly arms: ReadonlyArray<{
        readonly name: string;
        readonly role: "base" | "candidate" | "reference";
        readonly configuration: string;
    }>;
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