import { type Stratum } from "./score-difference.ts";
/** Sum of pair differences and number of planned pairs that it represents. */
export interface BlockContrast {
    readonly numerator: number;
    readonly pairs: number;
}
/** Lower-tail randomization p-value. Integer numerators retain all exact ties. */
export declare function sharpNullBlockP(blocks: readonly BlockContrast[]): number;
/**
 * Invert the upper-tail sign-flip test at a common additive shift. The empty subset
 * always counts. Each other subset enters the tail when the hypothesized shift reaches
 * that subset's mean. Keep ties by using the first boundary at which rejection stops.
 */
export declare function blockLowerBound(blocks: readonly BlockContrast[], alpha: number): number;
/** The lower tail of Binomial(negative + positive, 1/2), retaining ties. */
export declare function sharpNullPairP(negative: number, positive: number): number;
/** The within-run score bound, over the fixed case × block strata. */
export declare function withinRunLowerBound(strata: readonly Stratum[], alpha: number): number;
/** PASS requires strict clearance of the same margin by each bound. */
export declare function bothBoundsClear(block: number, within: number, margin: number): boolean;
//# sourceMappingURL=randomized-blocks.d.ts.map