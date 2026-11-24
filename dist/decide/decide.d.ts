import { Decision, type GateResult } from "../contracts/records/decision.ts";
import type { MeasureValue } from "../contracts/records/measure.ts";
import { type Plan } from "../contracts/records/plan.ts";
import type { Run } from "../contracts/records/run.ts";
import type { Trial } from "../contracts/records/trial.ts";
import { type Comparison, type ComparisonInput } from "../stats/compare.ts";
/** Everything a decision is computed from. Reports never compute anything new. */
export interface DecideInput {
    /** The plan that the run carries out. */
    readonly plan: Plan;
    /** The run record with its ledger. */
    readonly run: Run;
    /** The run's trial records. */
    readonly trials: readonly Trial[];
    /** The run's measure values. */
    readonly values: readonly MeasureValue[];
    /** The hard gates' results. */
    readonly gates: readonly GateResult[];
    /** The ISO 8601 timestamp recorded as the decision's `decidedAt`. */
    readonly decidedAt: string;
    /** The Ichnaea version, a semantic version, recorded in the decision. */
    readonly ichnaea: string;
}
/**
 * The comparison of one measure's counts. Descriptive reports use `compareCounts`; a test of the library
 * may pass descriptive results of its own (`decideWith`).
 */
export type Compare = (input: ComparisonInput) => Comparison;
export declare function seedOf(plan: Plan): number;
/**
 * Applies the decision rule to stored records (DESIGN § 6.3, § 6.4, decision 0011).
 *
 * The run verdict, in this order: INVALID when the records fail a check (the run does not belong to
 * the plan, an identity or template does not match, duplicate, unplanned or self-contradicting
 * records, a gate without a result, the budget, arms that differ beyond what the trigger varies and
 * the plan declares, the base has no value, a primary measure's coverage is below its floor); else
 * REGRESSION when a hard gate failed. Statistical decisions require recorded randomized
 * assignments. A Holm-adjusted block rejection gives REGRESSION, while PASS requires both bounds
 * for every primary measure. A within-run rejection alone gives INCONCLUSIVE. Missing scores
 * receive the completion adverse to the claim under test.
 */
export declare function decide(input: DecideInput): Decision;
/**
 * `decide` with the comparison given, so a test can decide from results of its own. Not exported
 * by the package. The callback affects descriptive intervals only.
 */
export declare function decideWith(input: DecideInput, compare: Compare): Decision;
//# sourceMappingURL=decide.d.ts.map