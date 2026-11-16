import type { Rng } from "./rng.ts";
import {
  type CaseScores,
  scorePermutationCore,
  type ScorePermutationResult,
} from "./score-permutation-core.ts";

export {
  type CaseScores,
  SCORE_PERMUTATION_RESAMPLES,
  SCORE_PERMUTATION_RESAMPLES_NEAR_LEVEL,
  type ScorePermutationResult,
} from "./score-permutation-core.ts";

/** Options of the score permutation test. The resample counts are fixed; no option changes them. */
export interface ScorePermutationOptions {
  /** Seeded generator for the Monte Carlo path. Required when the exact path is not cheap. */
  readonly rng?: Rng;
  /**
   * The levels the p-value will be compared with: alpha, or each level Holm may compare it with.
   * A Monte Carlo p within 3 standard errors of one of them is computed again with
   * SCORE_PERMUTATION_RESAMPLES_NEAR_LEVEL resamples and a new seed, and that result is reported.
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
 * case has at most 100,000 labellings, and the support times the number of cases is at most 5·10^7.
 * Otherwise seeded Monte Carlo with SCORE_PERMUTATION_RESAMPLES resamples,
 * p = (1 + count) / (1 + resamples), reported with its standard error and seed; a p within 3
 * standard errors of one of `levels` is computed again with SCORE_PERMUTATION_RESAMPLES_NEAR_LEVEL
 * resamples and a new seed. A case without a completed trial in an arm does not enter.
 */
export function scorePermutationTest(
  cases: readonly CaseScores[],
  options: ScorePermutationOptions = {},
): ScorePermutationResult {
  const { rng, levels } = options;
  return scorePermutationCore(cases, {
    ...(rng === undefined ? {} : { rng }),
    ...(levels === undefined ? {} : { levels }),
  });
}
