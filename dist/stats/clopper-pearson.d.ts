import { type Count, type Interval, type Sided } from "./types.ts";
/**
 * The exact Clopper–Pearson interval for one binomial proportion. Each bounded side holds its
 * share of 1 − level: (1 − level)/2 on two sides, 1 − level on one. Its coverage is at least the
 * level at every true rate of one binomial. For the pooled count of independent trials at unequal
 * rates, use `pooledClopperPearson`. Zero trials give [0, 1] with an undefined (NaN) estimate.
 */
export declare function clopperPearson(count: Count, level?: number, sided?: Sided): Interval;
/**
 * Clopper–Pearson on the pooled count at the adjusted level α′ = 1 − e^{−α} per bound
 * (1 − e^{−α/2} per tail for a two-sided interval). With independent trials at unequal rates, the
 * count is Poisson-binomial. The bound then misses the mean rate with probability below α, for every
 * set of rates (Hoeffding 1956, Theorem 4, as restated in Bancal and Sekatski 2022, § II; Greenberg
 * and Mohri 2014; and Weierstrass's product inequality). Unadjusted CP can miss at a rate up to
 * −ln(1 − α), at extreme means.
 *
 * The proof needs α′ ≤ 1/4 per bound, so a larger one is refused. The result carries the level
 * asked for, and the method "clopper-pearson-adjusted".
 */
export declare function pooledClopperPearson(count: Count, level?: number, sided?: Sided): Interval;
//# sourceMappingURL=clopper-pearson.d.ts.map