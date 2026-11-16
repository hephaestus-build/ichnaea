import { Decision, type GateResult, type MeasuredValue, type MeasureValue, type Plan, type Run, type Trial } from "../contracts/index.ts";
import { type CaseCounts, type Comparison, type ComparisonInput } from "../stats/index.ts";
/** Everything a decision is computed from. Reports never compute anything new. */
export interface DecideInput {
    readonly plan: Plan;
    readonly run: Run;
    readonly trials: readonly Trial[];
    readonly values: readonly MeasureValue[];
    readonly gates: readonly GateResult[];
    readonly decidedAt: string;
    readonly ichnaea: string;
}
/**
 * The comparison of one measure's counts. Every decision uses `compareCounts`; a test of the rule
 * may pass results of its own (`decideWith`, `decidePrimariesWith`).
 */
export type Compare = (input: ComparisonInput) => Comparison;
/**
 * The reason of an INCONCLUSIVE run when the unset validated margin floor alone keeps every primary
 * measure from NON-INFERIOR: each lower bound clears its effective margin, also with the measure's
 * missing trials imputed against non-inferiority (decision 0015). A stable unchanged candidate gets
 * it, so it must not read as a broken setup.
 */
export declare const FLOOR_NOT_SET_REASON = "No primary measure regressed, but no candidate can PASS yet: the validated margin floor for non-inferiority is not set.";
/** One primary measure's counts, as the decision rule reads them. */
export interface PrimaryCounts {
    readonly measure: string;
    readonly margin: number;
    readonly safetyMargin?: number;
    readonly valueType: MeasuredValue["type"];
    readonly cases: readonly CaseCounts[];
}
/** The verdict of one primary measure and how it was reached. */
export interface PrimaryVerdict {
    readonly verdict: "NON-INFERIOR" | "REGRESSION" | "INCONCLUSIVE";
    readonly comparison?: Comparison;
    /** The Holm-adjusted regression p-value, for a validated comparison. */
    readonly regressionPAdjusted?: number;
    /**
     * Why an INCONCLUSIVE measure is not non-inferior: the cases cannot tell (the lower bound does not
     * clear the effective margin, whether or not the non-inferiority result is validated), the
     * comparison is outside the validated domain, the bound clears the margin but the
     * non-inferiority result is not validated, or there is no comparison.
     */
    readonly cause?: "cannot-tell" | "unvalidated" | "non-inferiority-unvalidated" | "no-comparison";
    readonly notes: readonly string[];
}
/** What `decidePrimaries` decides from. */
export interface PrimariesInput {
    readonly estimand: Plan["estimand"];
    readonly alpha: number;
    readonly seed: number;
    readonly measures: readonly PrimaryCounts[];
}
/**
 * Per-measure verdicts for the primary measures (DESIGN § 6.3, REQ-51, decision 0015):
 * NON-INFERIOR when both results of the comparison are validated and the one-sided lower bound
 * exceeds −(δ − s), each at the unadjusted level (intersection-union, so a PASS needs no
 * adjustment); otherwise REGRESSION when the regression result is validated and the regression test
 * rejects Δ ≥ 0 after Holm across the comparisons whose regression result is validated; otherwise
 * INCONCLUSIVE. Holm covers only the tests that can produce REGRESSION, and a comparison whose
 * regression result is not validated cannot (decision 0008), so it stays out of the family. Whether
 * a result is validated depends on the cases, trials and margin, not on the outcomes, so the family
 * still holds the error rate at α. The measures are decided in order with one generator from
 * `seed`, so the same counts give the same verdicts.
 */
export declare function decidePrimaries(input: PrimariesInput): Map<string, PrimaryVerdict>;
/** `decidePrimaries` with the comparison given, so a test can decide from results of its own. */
export declare function decidePrimariesWith(input: PrimariesInput, compare: Compare): Map<string, PrimaryVerdict>;
/**
 * Applies the decision rule to stored records (DESIGN § 6.3, § 6.4, decision 0011).
 *
 * The run verdict, in this order: INVALID when the records fail a check (the run does not belong to
 * the plan, an identity or template does not match, duplicate, unplanned or self-contradicting
 * records, a gate without a result, the budget, arms that differ beyond what the trigger varies and
 * the plan declares, the base has no value, a primary measure's coverage is below its floor); else
 * REGRESSION when a hard gate failed, in either mode, because a gate does not depend on power; else
 * no verdict when the plan is estimate-only or the run is exploratory; else REGRESSION when a
 * primary measure regressed; else PASS when every primary measure is non-inferior; else
 * INCONCLUSIVE. Whenever a primary measure misses a trial in either arm, each measure's verdict is
 * tested against the imputation that works against it, and a verdict that changes is INCONCLUSIVE
 * (decision 0010).
 */
export declare function decide(input: DecideInput): Promise<Decision>;
/**
 * `decide` with the comparison given, so a test can decide from results of its own. Not exported
 * by the package: every decision Ichnaea makes uses `compareCounts`.
 */
export declare function decideWith(input: DecideInput, compare: Compare): Promise<Decision>;
//# sourceMappingURL=decide.d.ts.map