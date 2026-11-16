import { type Decision, type Real, type Run } from "../contracts/index.ts";
/** A number as reports show it: a percentage with one decimal, or a dash when undefined. */
export declare function percent(value: Real | number): string;
/** A difference in percentage points with its sign. */
export declare function points(value: Real | number): string;
/** One row of the per-measure table. */
export interface MeasureRow {
    readonly measure: string;
    readonly tier: string;
    readonly verdict: string;
    readonly arms: ReadonlyArray<{
        readonly arm: string;
        readonly rate: string;
        readonly interval: string;
        readonly n: string;
        readonly missing: number;
    }>;
    readonly difference?: {
        readonly estimate: string;
        readonly bound: string;
        readonly margin: string;
        readonly method: string;
        readonly negativeFlips: number;
        readonly positiveFlips: number;
        /**
         * Whether the bound is validated: only the comparison's non-inferiority result vouches for it
         * (decision 0015). A bound that is not validated is labelled so.
         */
        readonly validated: boolean;
        /** The numbers behind the difference axis, when the bound is finite. */
        readonly axis?: {
            readonly estimate: number;
            readonly lower: number;
            readonly margin: number;
            readonly validated: boolean;
        };
    };
    readonly notes: readonly string[];
}
/** One row of the power statement. */
export interface PowerRow {
    /** `planning` for the plan's statement, made before any call; `this run` for the run-time one. */
    readonly statement: "planning" | "this run";
    readonly measure: string;
    readonly cases: number;
    readonly replicates: number;
    readonly floor: string;
    readonly mde: string;
    readonly margin: string;
    /** Whether the margin is within reach of the minimum detectable effect, or why it is unknown. */
    readonly reach: string;
    /** The assumption behind a computed entry, or the reason an entry was not computed. */
    readonly assumption: string;
}
/** One imputation of the sensitivity analysis for one measure. */
export interface SensitivityRow {
    readonly measure: string;
    readonly imputation: string;
    readonly difference: string;
    readonly bound: string;
    /** Whether the bound is validated, as in `MeasureRow`. */
    readonly validated: boolean;
    readonly verdict: string;
    readonly changes: string;
}
/** The view model of a decision. Every output renders from it, so they show the same numbers. */
export interface DecisionView {
    readonly title: string;
    readonly verdict: string;
    /** What the verdict is about, shown next to it, for example "on these 12 cases". */
    readonly claim: string;
    readonly reason: string;
    /** How the verdict was reached: estimand, bounds and adjustments. */
    readonly method: string;
    readonly measures: readonly MeasureRow[];
    readonly gates: ReadonlyArray<{
        readonly gate: string;
        readonly result: string;
    }>;
    readonly flips: ReadonlyArray<{
        readonly measure: string;
        readonly case: string;
        readonly direction: string;
        readonly base: string;
        readonly candidate: string;
    }>;
    readonly power: readonly PowerRow[];
    readonly sensitivity: readonly SensitivityRow[];
    readonly missingness: string;
    readonly differingFactors: readonly string[];
    readonly limitations: readonly string[];
    readonly lineage: ReadonlyArray<readonly [string, string]>;
}
/** The label of a bound that its comparison's non-inferiority result does not vouch for. */
export declare const NOT_VALIDATED = "(not validated)";
/**
 * Builds the view model from a decision record alone. It computes nothing new: every number comes
 * from the record (REQ-82, REQ-128).
 */
export declare function decisionView(decision: Decision, suite: string, lineage?: Run["lineage"]): DecisionView;
//# sourceMappingURL=view.d.ts.map