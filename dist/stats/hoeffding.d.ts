import { type Interval, type Sided } from "./types.ts";
/**
 * Hoeffding's bound for a weighted mean Σ wᵢYᵢ of independent terms in [0, 1], with weights that
 * sum to 1: half-width √(ln(2/α)·Σwᵢ²/2) on two sides, √(ln(1/α)·Σwᵢ²/2) on one, clipped to
 * [0, 1]. Its coverage holds at every set of means, so it is conservative. It is the
 * interval where unequal weights leave no binomial count to invert.
 */
export declare function hoeffding(values: readonly number[], weights: readonly number[], level?: number, sided?: Sided): Interval;
//# sourceMappingURL=hoeffding.d.ts.map