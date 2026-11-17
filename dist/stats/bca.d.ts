import type { Rng } from "./rng.ts";
import { type Interval, type Sided, type Weighting } from "./types.ts";
/** One top cluster: the means of its cases (each case's replicates already averaged). */
export interface BcaCluster {
    /** The cluster's ID, a family or a case. Draws index the clusters in code-unit order of ID. */
    readonly id: string;
    /** The mean of each of the cluster's cases, in [0, 1]. */
    readonly caseMeans: readonly number[];
}
/** Why BCa gives no interval. */
export type BcaRefusal = "BCA_UNDEFINED" | "ZERO_WIDTH";
/** A BCa result: the interval, or why there is none. */
export type BcaResult = {
    /** The interval. */
    readonly interval: Interval;
    /** The bias correction z₀. */
    readonly z0: number;
    /** The jackknife acceleration a. */
    readonly acceleration: number;
    readonly refusal?: never;
} | {
    readonly interval?: never;
    readonly z0?: never;
    readonly acceleration?: never;
    /** Why there is no interval. */
    readonly refusal: BcaRefusal;
    /** The point estimate. */
    readonly estimate: number;
};
/**
 * The bias-corrected and accelerated (BCa) bootstrap interval, resampling the top clusters only.
 * The replicates of a case are never resampled. BCa respects transformations and stays inside
 * [0, 1]. z₀ = Φ⁻¹((#{θ* < θ̂ − tol} + ½·#{|θ* − θ̂| ≤ tol})/B), with tol a relative 1e-12: a
 * resampled estimate within rounding of the estimate counts half, so the many exact ties on a
 * lattice of case means neither push z₀ down nor depend on the order of summation. The
 * acceleration is the jackknife over clusters, a = Σd³ / (6·(Σd²)^{3/2}). The bounds are type-7
 * quantiles of the resampled estimates at the adjusted levels Φ(z₀ + (z₀ + z)/(1 − a(z₀ + z))).
 * They stay inside the range of the resampled estimates, so inside [0, 1]. Its coverage is not
 * validated.
 */
export declare function bcaInterval(input: readonly BcaCluster[], weighting: Weighting, rng: Rng, resamples: number, level?: number, sided?: Sided): BcaResult;
//# sourceMappingURL=bca.d.ts.map