/**
 * A labelled calibration set in columns: one entry per answer, answers grouped into items (the
 * resampling clusters), and each item in one sampling stratum.
 */
export interface LabelColumns {
    /** `binary` labels are 0 or 1 (1 is a defect); `levels` labels are 1 to `levels`. */
    readonly scale: "binary" | "levels";
    /** The number of levels, for the `levels` scale. */
    readonly levels: number;
    /** The number of items. */
    readonly cases: number;
    /** Per answer: its item, 0 to cases − 1. */
    readonly caseOf: readonly number[];
    /** Per answer: 0 is base, 1 is candidate, 2 is known-worse. */
    readonly configurationOf: readonly number[];
    /** Per answer: its weight, 1/π for inclusion probability π. */
    readonly weight: readonly number[];
    /** Per item: its stratum. The bootstrap resamples items within each stratum. */
    readonly stratumOf: readonly number[];
    /** Per answer: the first rater's label. */
    readonly first: readonly number[];
    /** Per answer: the second rater's label. */
    readonly second: readonly number[];
    /** Per answer: the judge's label. */
    readonly judge: readonly number[];
}
/** The answers of a resample: indices, repeated when an item is drawn more than once. */
export type Answers = readonly number[];
/** A statistic of reader `x` against reference `y` over a resample's answers, with the weights. */
export type Pairwise = (x: readonly number[], y: readonly number[], answers: Answers, w: readonly number[]) => number;
/** R's type-7 quantile of a sorted array. */
export declare function quantile(values: readonly number[], p: number): number;
/** The finite values, sorted. */
export declare function sorted(xs: readonly number[]): number[];
/** The weighted share of the reference's defects that `x` also marks: sensitivity. */
export declare const sensitivity: Pairwise;
/** The weighted share of the reference's non-defects that `x` also marks: specificity. */
export declare const specificity: Pairwise;
/**
 * Gwet's AC1 for two raters with answer weights: (p_o − p_e)/(1 − p_e), p_e = Σ π_k(1 − π_k)/(q − 1)
 * with q = 2, every count weighted. With unit weights it equals `gwetAc1` of ./stats, which takes
 * integer counts only.
 */
export declare const weightedAc1: Pairwise;
/** Krippendorff's ordinal alpha of two readers. It ignores the weights: levels are unweighted. */
export declare const ordinalAlpha: Pairwise;
/**
 * The judge against each rater (their mean) minus each rater against the other (their mean). For
 * a directional statistic such as sensitivity, the reference is the second argument, so the
 * rater–rater value is the mean of rater 2 against rater 1 and rater 1 against rater 2.
 */
export declare function gap(set: LabelColumns, statistic: Pairwise, answers: Answers): number;
/** The judge against each rater, the mean of the two. */
export declare function judgeHuman(set: LabelColumns, statistic: Pairwise, answers: Answers): number;
/** Each rater against the other, the mean of the two directions. */
export declare function humanHuman(set: LabelColumns, statistic: Pairwise, answers: Answers): number;
/** A label on [0, 1]: a yes/no label as it is, a level as (level − 1)/(levels − 1). */
export declare function valueOf(set: LabelColumns): (labels: readonly number[], i: number) => number;
/**
 * The bias between base and candidate: the weighted mean of (judge − the raters' mean) over the
 * candidate's answers, minus the same over the base's, on [0, 1]. With one answer per
 * configuration per item and unit weights, it equals the mean per-item difference.
 */
export declare function armBias(set: LabelColumns, answers: Answers, value: (labels: readonly number[], i: number) => number): number;
/**
 * The weighted mean quality (1 − label) of `labels` on known-worse minus base: the change from the
 * base to the known-worse configuration, on yes/no labels. Negative is a drop.
 */
export declare function pairChange(set: LabelColumns, answers: Answers, labels: (i: number) => number): number;
//# sourceMappingURL=statistics.d.ts.map