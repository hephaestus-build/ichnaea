import { type Count, type Interval, type Sided } from "./types.ts";
/**
 * The Wilson score interval for one proportion. Never Wald: Wald intervals undercover badly
 * below a few hundred trials. Zero trials give [0, 1] with an undefined (NaN) estimate.
 */
export declare function wilson(count: Count, level?: number, sided?: Sided): Interval;
/**
 * The Wilson interval on a mean of n values in [0, 1], with n as the count: the pooled mean of
 * scores at one trial per case. Its variance bound μ(1 − μ) holds for any value in [0, 1],
 * but its coverage is not guaranteed (minimum 0.838 in VALIDATION.md), so it is not validated.
 */
export declare function wilsonMean(mean: number, n: number, level?: number, sided?: Sided): Interval;
//# sourceMappingURL=wilson.d.ts.map