import { createRng } from "./rng.js";
import { scorePermutationCore, } from "./score-permutation-core.js";
export { SCORE_PERMUTATION_RESAMPLES, SCORE_PERMUTATION_RESAMPLES_NEAR_LEVEL, SCORE_PERMUTATION_WORK_LIMIT, } from "./score-permutation-core.js";
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
export function scorePermutationTest(cases, options = {}) {
    const { seed, levels } = options;
    return scorePermutationCore(cases, {
        ...(seed === undefined ? {} : { rng: createRng(seed) }),
        ...(levels === undefined ? {} : { levels }),
    });
}
//# sourceMappingURL=score-permutation.js.map