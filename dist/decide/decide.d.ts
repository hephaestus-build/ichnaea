import type { MeasuredValue } from "../contracts/primitives.ts";
import { Decision, type GateResult } from "../contracts/records/decision.ts";
import type { MeasureValue } from "../contracts/records/measure.ts";
import { type Plan } from "../contracts/records/plan.ts";
import type { Run } from "../contracts/records/run.ts";
import type { Trial } from "../contracts/records/trial.ts";
import { type CaseCounts, type Comparison, type ComparisonInput, type OneTrialChecks } from "../stats/compare.ts";
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
    /**
     * The A/A evidence that the plan cites in `aa`: each cited decision with the plan and the run it
     * decided, as the store holds them. `decide` checks each one (VALIDATION.md, "One trial per
     * case"); the CLI loads them from the store by run ID. Only a plan at one trial per case reads it.
     */
    readonly aa?: readonly AaEvidence[];
}
/** One cited A/A decision with the plan and the run it decided. */
export interface AaEvidence {
    /** The A/A decision record. */
    readonly decision: Decision;
    /** The plan that the decision names by digest. */
    readonly plan: Plan;
    /** The run that the decision names by digest. */
    readonly run: Run;
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
/** Map the plan’s unsigned 64-bit seed into the generator’s supported range. */
export declare function seedOf(plan: Plan): number;
/** One primary measure's counts, as the decision rule reads them. */
export interface PrimaryCounts {
    /** The measure's ID. */
    readonly measure: string;
    /** The non-inferiority margin, on the difference of pass rates; it must be below 1. */
    readonly margin: number;
    /** The part of the margin held back; the comparison uses `margin` minus it. Absent means 0. */
    readonly safetyMargin?: number;
    /** The measure's value type; only `binary` has a paired method. */
    readonly valueType: MeasuredValue["type"];
    /** The counts of each case under both arms. */
    readonly cases: readonly CaseCounts[];
}
/** The verdict of one primary measure and how it was reached. */
export interface PrimaryVerdict {
    /** The measure's verdict. */
    readonly verdict: "NON-INFERIOR" | "REGRESSION" | "INCONCLUSIVE";
    /** The paired comparison; absent when none could be run. */
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
    /** Notes on how the verdict was reached, such as why a result is not validated. */
    readonly notes: readonly string[];
}
/** What `decidePrimaries` decides from. */
export interface PrimariesInput {
    /** The question that the comparisons answer. */
    readonly estimand: Plan["estimand"];
    /** The one-sided level of each test, in (0, 0.5). */
    readonly alpha: number;
    /**
     * The seed of the one generator that every measure is decided with, an integer in [1, 2^32 - 1].
     */
    readonly seed: number;
    /** The primary measures, in the order they are decided. */
    readonly measures: readonly PrimaryCounts[];
    /** The checks of the records at one trial per case and arm, passed to every comparison. */
    readonly oneTrial?: OneTrialChecks;
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
export declare function decide(input: DecideInput): Decision;
/**
 * `decide` with the comparison given, so a test can decide from results of its own. Not exported
 * by the package: every decision Ichnaea makes uses `compareCounts`.
 */
export declare function decideWith(input: DecideInput, compare: Compare): Decision;
//# sourceMappingURL=decide.d.ts.map