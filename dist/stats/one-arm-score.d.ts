import { type Interval, type Sided } from "./types.ts";
/** One case's values in one arm: their sum, their count and the case's weight in the mean. */
export interface ScoreCell {
    /** The sum of the case's values, each in [0, 1]: a count of passes for binary values. */
    readonly sum: number;
    /** The number of values, at least 1. */
    readonly trials: number;
    /** The case's weight in the mean; the weights of all cells sum to 1. */
    readonly weight: number;
}
/**
 * The one-arm stratified score interval for a weighted mean of case rates, Σ wᵢpᵢ: it
 * inverts (θ̂ − θ)/√V(θ), with V(θ) = Σ wᵢ²·p̃ᵢ(1 − p̃ᵢ)/rᵢ at the rates p̃ᵢ that maximise the
 * likelihood under Σ wᵢp̃ᵢ = θ. It has no small-sample factor. For one case it is Wilson. Values in
 * [0, 1] enter as fractional sums, with the variance bound μ(1 − μ). Its coverage is not validated.
 */
export declare function oneArmScoreInterval(cells: readonly ScoreCell[], level?: number, sided?: Sided): Interval;
//# sourceMappingURL=one-arm-score.d.ts.map