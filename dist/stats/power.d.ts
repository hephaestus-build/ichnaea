import type { Rng } from "./rng.ts";
import { type ScoreOptions } from "./score-difference.ts";
/**
 * The smallest non-inferiority margin that can pass under `fixed-cases` when nothing changed and
 * every trial passes in both arms: the zero-noise floor of the stratified score bound. Real
 * within-case noise raises it.
 */
export declare function fixedCasesFloor(cases: number, replicates: number, alpha?: number, options?: ScoreOptions): number;
/**
 * The zero-noise floor for any trial count per case (every case passes every trial in both arms),
 * with equal case weights as `compareCounts` uses them. `trials[j]` is case j's trials per arm.
 */
export declare function zeroNoiseFloor(trials: readonly number[], alpha?: number, options?: ScoreOptions): number;
/** The same floor under `sampled-cases`: every pair concordant, the skewness-corrected Tango bound. */
export declare function sampledCasesFloor(cases: number, alpha?: number): number;
/** Approximate cases needed under `sampled-cases` for a margin at a discordance rate (true difference 0). */
export declare function sampledCasesNeeded(discordance: number, margin: number, alpha?: number, power?: number): number;
/** Inputs of a simulated minimum detectable effect under `fixed-cases`. */
export interface FixedCasesMdeInput {
    /** Per-case pass rates of the last comparable run, or a declared assumption. */
    readonly rates: readonly number[];
    /** Trials per case and arm: one count for every case, or one per case. */
    readonly replicates: number | readonly number[];
    readonly alpha?: number;
    readonly power?: number;
    readonly simulations?: number;
    readonly rng: Rng;
    readonly options?: ScoreOptions;
}
/**
 * The minimum detectable effect of the method itself, by simulation: with both arms drawn from
 * the same per-case rates (true difference 0), the margin that the non-inferiority test passes
 * with the stated power. It is the `power` quantile of the negated lower bound. No normal
 * approximation, so it is exact for the method up to Monte Carlo error.
 */
export declare function fixedCasesMde(input: FixedCasesMdeInput): {
    mde: number;
    floor: number;
    simulations: number;
};
//# sourceMappingURL=power.d.ts.map