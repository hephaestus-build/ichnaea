import type { GateResult as GateResultRecord } from "../contracts/records/decision.ts";
import type { MeasureValue as MeasureValueRecord } from "../contracts/records/measure.ts";
import type { Plan as PlanRecord } from "../contracts/records/plan.ts";
import type { Run as RunRecord } from "../contracts/records/run.ts";
import type { Trial as TrialRecord } from "../contracts/records/trial.ts";
/** The primary records of one run, written together. */
export interface RunRecords {
    /** The plan that the run carries out. */
    readonly plan: PlanRecord;
    /** The run record with its ledger. */
    readonly run: RunRecord;
    /** The run's trial records, one for each trial ID. */
    readonly trials: readonly TrialRecord[];
    /** The measure values, one for each measure and trial. */
    readonly values: readonly MeasureValueRecord[];
    /** The hard gates' results, one for each gate. */
    readonly gates: readonly GateResultRecord[];
}
/**
 * The rules every set of run records keeps: one record per trial, one value per measure and trial,
 * one result per gate. A second record would silently replace the first in any lookup, so it could
 * hide a regression. Returns one message per broken rule.
 */
export declare function recordProblems(records: Omit<RunRecords, "plan" | "run">): string[];
//# sourceMappingURL=records.d.ts.map