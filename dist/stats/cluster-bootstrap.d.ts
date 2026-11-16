import type { Rng } from "./rng.ts";
/** One observation. Null is missing, not zero; its cluster remains in the resampling frame. */
export interface ClusterObservation {
    /** The cluster the row belongs to, such as its case or family. */
    readonly cluster: string;
    /** The row's outcome, or null when it is missing. */
    readonly value: number | null;
}
/**
 * A recorded resampling schedule. Each draw selects as many clusters as the input has, with
 * replacement. Indices are zero-based and refer to `clusterIds` in the schedule's own order, which
 * lists each input cluster exactly once. The seed is any safe integer, as R's set.seed accepts.
 */
export interface ClusterSchedule {
    /** Every input cluster exactly once, in the order the draw indices refer to. */
    readonly clusterIds: readonly string[];
    /** One row per resample: a zero-based index into `clusterIds` for each selected cluster. */
    readonly draws: readonly (readonly number[])[];
    /** The generator and sampling method that wrote the draws, such as R's RNGkind. */
    readonly algorithm: string;
    /** The seed that wrote the draws. */
    readonly seed: number;
}
/** Native random draws, or a replay of a recorded schedule from a registered analysis. */
export type ClusterBootstrapOptions = {
    readonly level?: number;
} & ({
    readonly rng: Rng;
    readonly resamples: number;
    readonly schedule?: never;
} | {
    readonly schedule: ClusterSchedule;
    readonly rng?: never;
    readonly resamples?: never;
});
/**
 * A descriptive percentile interval for the mean of observed rows. Clusters are sampled equally;
 * all their observations travel together. Unequal clusters therefore keep their row weights.
 * This is estimate-only, never a validated decision method or evidence of non-inferiority.
 */
export interface ClusterBootstrapResult {
    /** The method's name. */
    readonly method: "cluster-percentile";
    /** Always true: the result is an estimate and carries no verdict. */
    readonly estimateOnly: true;
    /** Always false: no type-I or coverage study validates this method. */
    readonly validated: false;
    /** The mean of the observed values over all rows. */
    readonly estimate: number;
    /** The interval's lower bound, a type-7 quantile of the resampled means. */
    readonly lower: number;
    /** The interval's upper bound, a type-7 quantile of the resampled means. */
    readonly upper: number;
    /** The nominal two-sided level of the interval; its coverage is not established. */
    readonly level: number;
    /** The quantile definition, R's type 7. */
    readonly quantile: "R-type-7";
    /** The number of distinct clusters. */
    readonly clusters: number;
    /** The number of rows, missing ones included. */
    readonly observations: number;
    /** The number of rows with an observed value. */
    readonly available: number;
    /** The number of rows whose value is null. */
    readonly missing: number;
    /** The number of draws, including omitted ones. */
    readonly resamples: number;
    /** Draws containing no observed value are omitted, as in R's quantile(..., na.rm = TRUE). */
    readonly omittedResamples: number;
    /** Degenerate when every retained resampled mean is equal. */
    readonly intervalStatus: "regular" | "degenerate";
    /** How the draws were made: native seeded draws, or a replayed schedule. */
    readonly sampling: {
        readonly mode: "native" | "replay";
        readonly algorithm: string;
        readonly seed: number;
    };
    /** What the result does not support, for the reader of the estimate. */
    readonly limitations: readonly string[];
}
/**
 * Resamples whole clusters and recomputes the row-weighted mean in every draw. Pairing is preserved
 * by supplying a paired difference per row, or by replaying the same schedule for each arm.
 * Missing values retain their clusters but contribute to neither the mean's numerator nor its
 * denominator. For a planned-attempt estimand, callers must instead supply its defined 0/1 outcome
 * for every planned attempt, including attempts with unavailable quality evidence.
 */
export declare function clusterBootstrap(input: readonly ClusterObservation[], options: ClusterBootstrapOptions): ClusterBootstrapResult;
//# sourceMappingURL=cluster-bootstrap.d.ts.map