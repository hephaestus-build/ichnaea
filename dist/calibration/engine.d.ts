import type { Rng } from "../stats/index.ts";
import { type LabelColumns, type Pairwise } from "./statistics.ts";
/** The rule's values. */
export interface RuleValues {
    /** The largest accepted shortfall in agreement (D): AC1 for yes/no labels, ordinal alpha for levels. */
    readonly agreementTolerance: number;
    /** The largest accepted shortfall in sensitivity and in specificity, for yes/no labels. */
    readonly rateTolerance: number;
    /**
     * The rater floor, a precondition: the one-sided 95 % lower bound of rater–rater agreement must
     * reach it (AC1 for yes/no labels, ordinal alpha for levels).
     */
    readonly raterFloor: {
        readonly ac1: number;
        readonly alpha: number;
    };
    /**
     * The equivalence margin of the bias between base and candidate, on [0, 1]: its 90 % interval
     * must lie within ±margin.
     */
    readonly armBiasMargin: {
        readonly binary: number;
        readonly levels: number;
    };
    /** Item resamples. */
    readonly resamples: number;
}
/** A condition's result: whether it holds, and the lower bound it was read from. */
export interface ConditionResult {
    /** Whether the condition holds. */
    readonly holds: boolean;
    /** The one-sided 95 % lower bound; NaN when every resample left it undefined. */
    readonly lower: number;
}
/** The judge's slope against people on the base against known-worse pair, on quality (1 − defect). */
export interface Slope {
    /** β = judge change ÷ human change. */
    readonly estimate: number;
    /** The one-sided 95 % item-cluster lower bound of β, capped at 1. */
    readonly lower: number;
    /** The human change (the raters' mean quality on known-worse minus base); negative is a drop. */
    readonly humanChange: number;
    /** Its one-sided 95 % upper bound: the drop is shown when it is below 0. */
    readonly humanChangeUpper: number;
    /** B: the shown bound of (judge change − human change) on this pair. */
    readonly pairBound: number;
}
/** The bias between base and candidate, on [0, 1]. */
export interface ArmBias {
    /** The estimate on the whole set. */
    readonly estimate: number;
    /** The two-sided 90 % interval. */
    readonly lower90: number;
    /** The two-sided 90 % interval. */
    readonly upper90: number;
    /** max(|lower90|, |upper90|). */
    readonly shownBound: number;
}
/** The status statistics: D, and for yes/no labels the sensitivity and specificity gaps. */
export type StatusStatistic = "agreement" | "sensitivity" | "specificity";
/** What the bootstrap gives. */
export interface Bootstrap {
    /**
     * The rater floor and each status statistic's gap, with their lower bounds, and the bias gate:
     * the bias between base and candidate is within its margin.
     */
    readonly conditions: {
        readonly ratersFloor: ConditionResult;
        readonly armBias: {
            readonly holds: boolean;
        };
    } & Partial<Record<StatusStatistic, ConditionResult>>;
    /** The bias between base and candidate. */
    readonly armBias: ArmBias;
    /** The slope, when the set has known-worse answers and yes/no labels. */
    readonly slope?: Slope;
    /** Resamples in which a status statistic was undefined: counted, never dropped silently. */
    readonly undefinedResamples: number;
}
/** The status statistics of a scale, by name. */
export declare function statusStatistics(scale: LabelColumns["scale"]): Partial<Record<StatusStatistic, Pairwise>>;
/** The agreement statistic of a scale. */
export declare function agreementStatistic(scale: LabelColumns["scale"]): Pairwise;
/**
 * Runs the bootstrap: each resample draws, within each stratum, as many items as it has, with
 * replacement, and takes all their answers. A resample in which a status statistic is undefined
 * (no defect or no non-defect to condition on, or an undefined alpha) is counted and left out of
 * that statistic's quantile.
 */
export declare function bootstrapCalibration(set: LabelColumns, values: RuleValues, rng: Rng): Bootstrap;
/** Whether every condition of the bootstrap holds: the judge is calibrated. */
export declare function calibrated(boot: Bootstrap): boolean;
/** The point estimates on the whole set. */
export declare function estimates(set: LabelColumns): {
    readonly humanHuman: number;
    readonly judgeHuman: number;
    readonly sensitivity?: {
        readonly judge: number;
        readonly humanHuman: number;
    };
    readonly specificity?: {
        readonly judge: number;
        readonly humanHuman: number;
    };
};
//# sourceMappingURL=engine.d.ts.map