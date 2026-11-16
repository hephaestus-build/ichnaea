import { type Rng } from "./rng.ts";
/**
 * One case's completed trial values under both arms, each a score in [0, 1]. A proportion arrives
 * already reduced to one value per trial: its items are never trials (decision 0008).
 */
export interface CaseScores {
    /** The case's ID. */
    readonly id: string;
    /** The case's family, a group of related cases; absent means the case is a family of its own. */
    readonly family?: string;
    /** The case's completed trial values under the base arm. */
    readonly base: readonly number[];
    /** The case's completed trial values under the candidate arm. */
    readonly candidate: readonly number[];
}
/** The result of the within-case permutation test on scores. */
export interface ScorePermutationResult {
    /** The equal-weight mean of per-case differences in means, candidate minus base. */
    readonly statistic: number;
    /**
     * One-sided p-value toward a drop. Exact: the share of within-case arm labellings with T at most
     * T observed. Monte Carlo: (1 + count) / (1 + resamples).
     */
    readonly p: number;
    /** The test's stable name: the exact path or the Monte Carlo path. */
    readonly method: "within-case-permutation-exact" | "within-case-permutation-monte-carlo";
    /**
     * The exact path's work estimate W (SCORE_PERMUTATION_WORK_LIMIT), when the values lie on a
     * lattice and every case is within the per-case limits; the exact path ran if W was at most the
     * limit. Absent when the values or a case rule the exact path out before W can be computed.
     */
    readonly work?: number;
    /** Monte Carlo only: the resamples behind `p`. */
    readonly resamples?: number;
    /** Monte Carlo only: the standard error of `p`. */
    readonly monteCarloSE?: number;
    /** Monte Carlo only: the seed of the generator behind `p`. */
    readonly seed?: number;
}
/** Every setting of the score permutation test. */
export interface ScorePermutationSettings {
    /**
     * Generator for the Monte Carlo path, required when the exact path does not run. The result
     * records its seed, which reproduces `p` only when the generator was fresh.
     */
    readonly rng?: Rng;
    /** Monte Carlo resamples. */
    readonly resamples?: number;
    /**
     * The levels the p-value will be compared with: alpha, or each level Holm may compare it with.
     * A Monte Carlo p within 3 standard errors of one of them is computed again with
     * SCORE_PERMUTATION_RESAMPLES_NEAR_LEVEL resamples and the seed `rerunSeed(seed)`, and that
     * result is reported.
     */
    readonly levels?: readonly number[];
    /** Whether to enumerate when that is cheap (default true). `false` always runs Monte Carlo. */
    readonly exact?: boolean;
}
/** Monte Carlo resamples of the score permutation test when it cannot enumerate. */
export declare const SCORE_PERMUTATION_RESAMPLES = 10000;
/** Monte Carlo resamples when the p-value lies within 3 standard errors of a level. */
export declare const SCORE_PERMUTATION_RESAMPLES_NEAR_LEVEL = 100000;
/**
 * Largest work estimate W of the exact path. W is the sum over cases, in the order the convolution
 * takes them, of (the support of the partial distribution before the case) × (the number of
 * distinct contributions of the case): the multiply-adds the convolution performs. Set from the
 * benchmark in VALIDATION.md so that the slowest exact case stays near 1 second on a CI runner.
 */
export declare const SCORE_PERMUTATION_WORK_LIMIT = 50000000;
/** The seed of the rerun near a level: (seed + 1,000,003) mod (2^32 − 1), and 1 if that is 0. */
export declare function rerunSeed(seed: number): number;
/**
 * The exact path's work estimate W for a table, or undefined when the values are off every small
 * lattice or a case has too many labellings. Internal, for the tests and the benchmark.
 */
export declare function exactWork(cases: readonly CaseScores[]): number | undefined;
/**
 * The exact p-value whatever its work, or undefined when the values are off every small lattice or
 * a case has too many labellings. Internal, for the benchmark that sets the work limit and for the
 * tests; the test itself never runs the exact path above the limit.
 */
export declare function exactPathIgnoringWork(cases: readonly CaseScores[]): {
    readonly p: number;
    readonly work: number;
} | undefined;
/**
 * Within-case permutation test of "no difference in any case" for scores in [0, 1] (R-P), on the
 * equal-weight mean of per-case differences in means, the fixed-cases estimand. Within each case
 * the pooled trials are reassigned to the arms, keeping each arm's completed count, and cases are
 * permuted independently. One-sided toward a drop; ties count as at most T observed.
 *
 * Exact by convolution when every value lies on a lattice of step 1/D with D at most 1,000, every
 * case has at most 100,000 labellings, and the work estimate W is at most
 * SCORE_PERMUTATION_WORK_LIMIT. Otherwise seeded Monte Carlo, p = (1 + count) / (1 + resamples),
 * reported with its standard error and seed; a p within 3 standard errors of one of `levels` is
 * computed again with 100,000 resamples and the seed `rerunSeed(seed)`, and that result is
 * reported. A case without a completed trial in an arm does not enter.
 */
export declare function scorePermutationCore(cases: readonly CaseScores[], options?: ScorePermutationSettings): ScorePermutationResult;
//# sourceMappingURL=score-permutation-core.d.ts.map