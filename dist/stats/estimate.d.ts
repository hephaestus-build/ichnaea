import type { Rng } from "./rng.ts";
import { type Interval, type Sided, type Weighting } from "./types.ts";
/** What an estimate is about: the cases that ran, or a population they were drawn from. */
export type EstimateEstimand = "these-cases" | "population";
/** One case of one arm. */
export interface EstimateCase {
    /** The case's ID, unique in the estimate. */
    readonly id: string;
    /** The case's family; a case without one is a family of its own. */
    readonly family?: string;
    /** The values of the completed trials: 0 or 1 for binary measures, in [0, 1] for scores. */
    readonly values: readonly number[];
    /** The trials the plan asked for, at least the completed ones; by default the completed ones. */
    readonly planned?: number;
}
/** A one-arm estimate. */
export interface EstimateInput {
    /** The value type. A level with equal spacing or a proportion is passed as a score. */
    readonly valueType: "binary" | "score";
    /** By default `these-cases`. */
    readonly estimand?: EstimateEstimand;
    /** By default `per-case`. */
    readonly weighting?: Weighting;
    /** Every planned case of the arm, with or without values. */
    readonly cases: readonly EstimateCase[];
    /** By default 0.95. */
    readonly level?: number;
    /** By default two-sided. */
    readonly sided?: Sided;
    /**
     * For `population` only. `frame` states that the cases were drawn from a declared sampling frame
     * that the caller checks. The generator draws the clusters, and its seed is recorded.
     */
    readonly population?: {
        readonly frame: boolean;
        readonly rng: Rng;
        readonly resamples: number;
    };
}
/**
 * What the interval's coverage rests on. `conservative`: a theorem bounds it at every true rate.
 * `not-validated`: no study has shown it, so the card says "coverage not validated".
 */
export type Coverage = "conservative" | "not-validated";
/** An interval with what its coverage rests on. */
export interface EstimateInterval extends Interval {
    /** What the interval's coverage rests on. */
    readonly coverage: Coverage;
}
/** Why an estimate has no interval. */
export type NoInterval = "NO_VALUES" | "NO_SAMPLING_FRAME" | "FEWER_THAN_30_CLUSTERS" | "BCA_UNDEFINED" | "ZERO_WIDTH";
/** A one-arm estimate with its interval, its worst-case bounds and its operational estimand. */
export interface EstimateResult {
    /** The input's value type. */
    readonly valueType: "binary" | "score";
    /** The estimand the interval answers. */
    readonly estimand: EstimateEstimand;
    /** How the cases weigh in the mean. */
    readonly weighting: Weighting;
    /** The weighted mean of the case means over the cases with a value; NaN when there is none. */
    readonly estimate: number;
    /** Null when there is no interval, with the reason in `noInterval`. Never zero-width. */
    readonly interval: EstimateInterval | null;
    /** Why there is no interval, when `interval` is null. */
    readonly noInterval?: NoInterval;
    /** The number of cases with at least one value. */
    readonly cases: number;
    /** The number of planned cases with no value. */
    readonly missingCases: number;
    /**
     * The estimate over every planned trial, with each missing trial a failure (`low`) or a pass
     * (`high`), under the same weighting.
     */
    readonly worstCase: {
        /** Every missing trial a failure. */
        readonly low: number;
        /** Every missing trial a pass. */
        readonly high: number;
    };
    /**
     * The operational estimand: missing as failure, over planned trials, with its own interval
     * Its estimate is `worstCase.low`. It never enters a compare decision.
     */
    readonly operational: EstimateInterval;
    /** For `population`: how the clusters were drawn. */
    readonly resampling?: {
        /** The generator's algorithm. */
        readonly algorithm: string;
        /** The generator's seed. */
        readonly seed: number;
        /** The number of resamples. */
        readonly resamples: number;
        /** The number of top clusters. */
        readonly clusters: number;
    };
}
/** The fewest top clusters a `population` interval needs. */
export declare const POPULATION_MIN_CLUSTERS = 30;
/**
 * A one-arm estimate, by these rules.
 *
 * `these-cases`, from within-case variance only:
 * - one trial per case, binary, equal weights: Clopper–Pearson on the pooled count at the adjusted
 *   level, conservative for any rates (`pooledClopperPearson`);
 * - one trial per case, scores, equal weights: Wilson on the pooled mean, not validated;
 * - one trial per case, unequal weights (per family, families of different sizes): Hoeffding's
 *   bound, conservative;
 * - otherwise: the one-arm stratified score interval, not validated.
 *
 * `population`: BCa over the top clusters (families, else cases), with at least 30 clusters and a
 * declared frame, not validated.
 */
export declare function estimate(input: EstimateInput): EstimateResult;
//# sourceMappingURL=estimate.d.ts.map