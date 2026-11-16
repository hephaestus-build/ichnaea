import { type Count, type Interval, type Sided } from "./types.ts";
/**
 * The Wilson score interval for one proportion. Never Wald: Wald intervals undercover badly
 * below a few hundred trials. Zero trials give [0, 1] with an undefined (NaN) estimate.
 */
export declare function wilson(count: Count, level?: number, sided?: Sided): Interval;
//# sourceMappingURL=wilson.d.ts.map