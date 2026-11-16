import type { Rng } from "./rng.ts";
import { type ScoreOptions, type Stratum } from "./score-difference.ts";
import { type Count, type Interval } from "./types.ts";
/** The question an estimate answers. */
export type Estimand = "fixed-cases" | "sampled-cases";
/**
 * One arm's binary outcomes on one case: the completed trials that passed, of all completed trials.
 * A trial with no value (an infrastructure failure, a trial not run) is not a trial here.
 */
export type ArmCounts = Count;
/** Counts of one case under both arms. An arm without trials is missing. */
export interface CaseCounts {
    readonly id: string;
    readonly family?: string;
    readonly base: ArmCounts;
    readonly candidate: ArmCounts;
}
/** Counts from the 0 and 1 outcomes of an arm's completed trials. */
export declare function countsFromOutcomes(outcomes: readonly (0 | 1)[]): ArmCounts;
/**
 * A measure's value type. Only `binary`, one 0 or 1 per trial, has a validated method. A proportion
 * is several items in one output: its items are never independent trials, so it cannot be passed
 * as counts.
 */
export type ValueType = "binary" | "proportion" | "score" | "ordinal";
/** A paired comparison for one binary measure. */
export interface ComparisonInput {
    readonly estimand: Estimand;
    /** The measure's value type; anything but `binary` is refused (EstimandError). */
    readonly valueType: ValueType;
    readonly cases: readonly CaseCounts[];
    /** One-sided level of the non-inferiority and regression tests. */
    readonly alpha: number;
    /** Non-inferiority margin minus the safety margin: H0 is difference <= -margin. */
    readonly margin: number;
    readonly rng?: Rng;
}
/** The result of a paired comparison. */
export interface Comparison {
    readonly estimand: Estimand;
    /**
     * One-sided lower interval matching the non-inferiority test. A lower bound above 0, a claim that
     * the candidate is better, is descriptive: it is the test at a margin of 0, below the validated
     * margin floor, so no result vouches for it (decision 0009).
     */
    readonly difference: Interval;
    /** p-value of H0: difference <= -margin. */
    readonly nonInferiorityP: number;
    /** p-value of H0: difference >= 0 (unadjusted). */
    readonly regressionP: number;
    /** The stable name of the regression test's method, recorded in decisions. */
    readonly regressionMethod: string;
    /** Cases with at least one completed trial in each arm: all of them enter the analysis. */
    readonly usedCases: number;
    /** Cases with no completed trial in an arm. They are missing and count against coverage. */
    readonly excludedCases: number;
    /**
     * Whether the regression test's result lies inside the domain where its type-I error is shown
     * (VALIDATION.md). It does not depend on the margin, and it never vouches for the interval.
     */
    readonly regression: Validity;
    /**
     * Whether the non-inferiority result, the interval against the margin, lies inside the domain
     * where its coverage is shown: the regression domain, plus an established margin floor and an
     * effective margin from that floor up to VALIDATED_MARGIN_CEILING. No verdict may rest on a
     * result that is not validated (decision 0008).
     */
    readonly nonInferiority: Validity;
}
/** Whether one result of a comparison is validated, and why not. */
export interface Validity {
    readonly validated: boolean;
    /** Why the result is not validated. Empty when it is. */
    readonly limitations: readonly string[];
}
/** Thrown when the data cannot support the estimand. The decision then runs estimate-only. */
export declare class EstimandError extends Error {
    readonly name = "EstimandError";
}
/** The fixed-cases domain the simulation studies cover (VALIDATION.md, decision 0009). */
export declare const VALIDATED_FIXED_CASES: {
    readonly minCases: number;
    readonly maxTrials: number;
    readonly minShareWithTwoTrials: number;
};
/**
 * The fixed-cases case selection and lower bound, as `compareCounts` computes them: every case with
 * at least one completed trial in each arm, equal case weights, the stratified Miettinen–Nurminen
 * score interval with the N/(N−1) factor. The simulation studies call this function, so they test
 * the decision path itself. It takes no score options: every other variant is outside the validated
 * domain (a variant without the factor undercovers), so a caller cannot select one here.
 */
export declare function fixedCasesInterval(cases: readonly CaseCounts[], level: number): {
    interval: Interval;
    strata: Stratum[];
    options: ScoreOptions;
};
/**
 * Fewest cases for a sampled-cases method. Below it: estimate-only. The method also needs one case
 * per family, so it needs as many families as cases.
 */
export declare const SAMPLED_CASES_MIN_CASES = 300;
/**
 * Smallest effective non-inferiority margin for the fixed-cases interval: the declared margin minus
 * any safety margin, which is the `margin` that `compareCounts` takes. A placeholder: under
 * heterogeneous effects the lower bound can undercover at small margins, and the floor is not yet
 * established (VALIDATION.md, "The validated domain"). A margin of 0 is not a non-inferiority test.
 */
export declare const VALIDATED_MARGIN_FLOOR = 0.05;
/**
 * Whether the margin floor is established. Until a reviewed search sets it, every non-inferiority
 * result is not validated, whatever its margin (VALIDATION.md, "The validated domain").
 */
export declare const VALIDATED_MARGIN_FLOOR_SET = false;
/** The reason every non-inferiority result gives while the floor is not set. */
export declare const MARGIN_FLOOR_NOT_SET = "the validated margin floor is not set yet";
/**
 * Largest effective non-inferiority margin for the fixed-cases interval. A margin above 30 points
 * says nothing useful about a drop.
 */
export declare const VALIDATED_MARGIN_CEILING = 0.3;
/**
 * Chooses and runs the paired method for a binary measure. Proportion, score and ordinal measures
 * have no validated method yet (decision 0008) and never reach it.
 *
 * - `fixed-cases`: every completed trial counts. A case with at least one completed trial in each
 *   arm enters the stratified Miettinen–Nurminen score interval and test with equal case weight, so
 *   the estimate is the mean of per-case differences. A case with no completed trial in an arm is
 *   excluded and counted. The regression test is the exact stratified conditional test when every
 *   case and arm has the same number of trials, and a within-case permutation test otherwise.
 * - `sampled-cases`, one trial per case and arm, one case per family, at least 300 cases: Tango's
 *   skewness-corrected score interval. It is experimental, so never validated.
 * - `sampled-cases` otherwise: no method; an EstimandError makes the measure estimate-only.
 */
export declare function compareCounts(input: ComparisonInput): Comparison;
//# sourceMappingURL=compare.d.ts.map