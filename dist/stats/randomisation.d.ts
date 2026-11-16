import type { Rng } from "./rng.ts";
import type { TestResult } from "./types.ts";
/** Monte Carlo resamples when a randomisation test cannot enumerate. */
export declare const DEFAULT_RESAMPLES = 10000;
/**
 * Within-case permutation test of "no difference in any case", for the mean of per-case
 * differences (the fixed-cases estimand with equal case weights). Arm labels are permuted within
 * each case, so each case's candidate successes are hypergeometric given its total. Monte Carlo
 * with a seeded generator; p = (1 + count) / (1 + resamples). One-sided toward a drop (`less`).
 */
export declare function withinCasePermutationTest(strata: ReadonlyArray<{
    readonly candidate: {
        successes: number;
        trials: number;
    };
    readonly base: {
        successes: number;
        trials: number;
    };
}>, rng: Rng, resamples?: number): TestResult;
//# sourceMappingURL=randomisation.d.ts.map