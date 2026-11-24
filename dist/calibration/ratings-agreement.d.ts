import { type AlphaMetric } from "../stats/agreement.ts";
/** Canonical input for a descriptive report about ratings. Null means a rater did not score the unit. */
export interface RatingSet {
    /** The distance between ratings. */
    readonly metric: AlphaMetric;
    /** Units in a fixed rater column order, with item and stratum for resampling. */
    readonly units: readonly {
        readonly item: string;
        readonly stratum: string;
        readonly raters: readonly (number | null)[];
    }[];
}
/** Public aggregates only. Item IDs, stratum labels, and ratings stay in the input. */
export interface RatingAgreement {
    /** The agreement statistic reported. */
    readonly statistic: "krippendorff-alpha";
    /** The distance used to measure disagreement. */
    readonly metric: RatingSet["metric"];
    /** Alpha, or null when the ratings do not define it. */
    readonly estimate: number | null;
    /** Items, units, and ratings before and after excluding units with fewer than two ratings. */
    readonly counts: {
        readonly items: number;
        readonly units: number;
        readonly pairedUnits: number;
        readonly pairedItems: number;
        readonly raters: number;
        readonly ratings: number;
        readonly pairedRatings: number;
    };
    /** The descriptive percentile interval, with null bounds when unavailable. */
    readonly interval: {
        readonly method: "item-cluster-percentile";
        readonly level: 0.95;
        readonly validated: false;
        readonly seed: number;
        readonly algorithm: string;
        readonly lower: number | null;
        readonly upper: number | null;
        readonly resamples: number;
        readonly omittedResamples: number;
        readonly unavailableReason: string | null;
    };
}
/** Resample whole items within each stratum, then recompute alpha in every draw. */
export declare function summarizeRatings(input: RatingSet, seed: number): RatingAgreement;
//# sourceMappingURL=ratings-agreement.d.ts.map