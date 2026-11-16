import { type CaseScores, type ScorePermutationResult } from "./score-permutation-core.ts";
export { type CaseScores, SCORE_PERMUTATION_RESAMPLES, SCORE_PERMUTATION_RESAMPLES_NEAR_LEVEL, SCORE_PERMUTATION_WORK_LIMIT, type ScorePermutationResult, } from "./score-permutation-core.ts";
/** Options of the score permutation test. The resample counts are fixed; no option changes them. */
export interface ScorePermutationOptions {
    /**
     * Seed of the generator for the Monte Carlo path, an integer from 1 to 2^32 − 1, required when
     * the exact path does not run. The test creates its own generator, so the recorded seed always
     * reproduces the p-value.
     */
    readonly seed?: number;
    /**
     * The levels the p-value will be compared with: alpha, or each level Holm may compare it with.
     * A Monte Carlo p within 3 standard errors of one of them is computed again with
     * SCORE_PERMUTATION_RESAMPLES_NEAR_LEVEL resamples and the seed (seed + 1,000,003) mod (2^32 − 1),
     * or 1 if that is 0, and that result is reported.
     */
    readonly levels?: readonly number[];
}
/**
 * Within-case permutation test of "no difference in any case" for scores in [0, 1] (R-P), on the
 * equal-weight mean of per-case differences in means, the fixed-cases estimand. Within each case
 * the pooled trials are reassigned to the arms, keeping each arm's completed count, and cases are
 * permuted independently. One-sided toward a drop; ties count as at most T observed.
 *
 * Exact by convolution when every value lies on a lattice of step 1/D with D at most 1,000, every
 * case has at most 100,000 labellings, and the work estimate W (recorded in the result) is at most
 * SCORE_PERMUTATION_WORK_LIMIT. Otherwise seeded Monte Carlo with SCORE_PERMUTATION_RESAMPLES
 * resamples, p = (1 + count) / (1 + resamples), reported with its standard error and seed, and
 * computed again near a level as `levels` says. A case without a completed trial in an arm does
 * not enter.
 */
export declare function scorePermutationTest(cases: readonly CaseScores[], options?: ScorePermutationOptions): ScorePermutationResult;
//# sourceMappingURL=score-permutation.d.ts.map