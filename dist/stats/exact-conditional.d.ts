import type { Stratum } from "./score-difference.ts";
import type { TestResult } from "./types.ts";
/**
 * Exact stratified conditional test of "no difference in any stratum" (a stratified
 * permutation test of arm labels within cases). Conditional on each stratum's total successes,
 * the candidate's successes are hypergeometric, and their sum has the convolution of those
 * distributions. Returns the one-sided p-value for a lower (`less`) or higher (`greater`)
 * candidate total. Valid at any size; conservative because the statistic is discrete.
 */
export declare function exactStratifiedTest(strata: readonly Stratum[], alternative: "less" | "greater"): TestResult;
//# sourceMappingURL=exact-conditional.d.ts.map