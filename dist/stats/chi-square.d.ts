/**
 * The p-quantile of the χ² distribution with df > 0 degrees of freedom, by bisection: on the lower
 * tail P(df/2, x/2) = p up to p = 1/2, and on the upper tail Q(df/2, x/2) = 1 − p above it, where
 * 1 − P would round the small tail away. It refuses any p outside (0, 1).
 */
export declare function chiSquareQuantile(p: number, df: number): number;
//# sourceMappingURL=chi-square.d.ts.map