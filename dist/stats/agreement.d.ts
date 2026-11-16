/**
 * Agreement between raters: raw agreement, Cohen's kappa, Gwet's AC1 and Krippendorff's alpha.
 * Point estimates only, validated against R. No interval for them is validated: a caller that
 * resamples cases gets an estimate-only interval with no coverage study behind it. Kappa and alpha
 * can be NaN in a resample (one category throughout, or no paired variation). Such a caller counts
 * the NaN replicates, reports their share, and never sorts them into a percentile or drops them
 * silently. AC1 is never NaN.
 */
/**
 * A square table of counts: `table[i][j]` is the number of items that the first rater put in
 * category `i` and the second rater in category `j`. Its size is the number of declared
 * categories, including categories that nobody chose: Gwet's AC1 depends on that number.
 */
export type AgreementTable = readonly (readonly number[])[];
/** A confusion table built from two raters' labels on the same items. */
export interface ConfusionTable {
    /** The declared categories, in the order of the table's rows and columns. */
    readonly categories: readonly string[];
    /** The counts, `table[i][j]` as in {@link AgreementTable}. */
    readonly table: number[][];
    /** The number of items that both raters labelled. */
    readonly pairs: number;
    /** The number of items left out because at least one rater gave no label. */
    readonly skipped: number;
}
/**
 * Builds the confusion table of two raters. A null label is missing: the item is left out and
 * counted in `skipped`, never put in a category. A label outside `categories` throws, so a typo
 * cannot become a silent disagreement.
 */
export declare function confusionTable(first: readonly (string | null)[], second: readonly (string | null)[], categories: readonly string[]): ConfusionTable;
/** The share of items on which both raters chose the same category. */
export declare function rawAgreement(table: AgreementTable): number;
/**
 * Cohen's kappa, unweighted: (p_o − p_e) / (1 − p_e), with p_e from each rater's own marginal
 * shares. NaN when p_e = 1, that is, when both raters put every item in the same category: chance
 * then explains all agreement and kappa is undefined.
 */
export declare function cohenKappa(table: AgreementTable): number;
/**
 * Gwet's AC1 for two raters: (p_o − p_e) / (1 − p_e), with p_e = Σ_k π_k (1 − π_k) / (q − 1),
 * where π_k is the share of all labels, from both raters, in category k and q is the number of
 * declared categories (the table's size). Unlike kappa it stays stable when one category is rare.
 * It is never NaN: p_e ≤ 1/q < 1.
 */
export declare function gwetAc1(table: AgreementTable): number;
/** The distance metrics of Krippendorff's alpha. */
export type AlphaMetric = "nominal" | "ordinal" | "interval";
/**
 * Krippendorff's alpha, 1 − D_o / D_e, over a reliability matrix: one row per unit (item), one
 * entry per rater, null for a missing value. Any number of raters, and missing values, are allowed.
 * A unit with fewer than two values cannot be paired and is left out. The ordinal metric uses the
 * frequencies of the values in between (Krippendorff 2011), so the numbers only need to be in
 * order; the interval metric uses their differences. NaN when fewer than two values can be paired
 * or when every paired value is the same: alpha is then undefined.
 *
 * Meant for rating scales with a few distinct values. It keeps a v × v coincidence matrix for v
 * distinct values, so its memory grows with v², and its time with v² plus the pairs within units;
 * continuous scores with thousands of distinct values need another statistic.
 */
export declare function krippendorffAlpha(units: readonly (readonly (number | null)[])[], metric: AlphaMetric): number;
//# sourceMappingURL=agreement.d.ts.map