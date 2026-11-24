import type { Real } from "../contracts/primitives.ts";
import type { Decision } from "../contracts/records/decision.ts";
import type { Run } from "../contracts/records/run.ts";
/** A number as reports show it: a percentage with one decimal, or a dash when undefined. */
export declare function percent(value: Real | number): string;
/** A difference in percentage points with its sign. */
export declare function points(value: Real | number): string;
type DecisionNoise = NonNullable<Decision["measures"][number]["noise"]>;
/** One row of the per-measure table. */
export interface MeasureRow {
    /** The measure's ID. */
    readonly measure: string;
    /** The measure's tier: `primary` or `secondary`. */
    readonly tier: string;
    /** The measure's verdict. */
    readonly verdict: string;
    /** The quantity the measure estimates. */
    readonly estimand: string;
    /** One entry for each arm: its rate, interval, available of planned trials and missing trials. */
    readonly arms: ReadonlyArray<{
        readonly arm: string;
        readonly rate: string;
        readonly interval: string;
        readonly n: string;
        readonly missing: number;
        readonly denominators: {
            readonly observedCases: number | null;
            readonly plannedCases: number | null;
            readonly observedTrials: number;
            readonly plannedTrials: number;
            readonly caseCountsReason?: string;
        };
        readonly estimand: "equal-weight observed cases";
        readonly method: string;
        readonly level: number;
        readonly sidedness: string;
        readonly validity: {
            readonly validated: boolean;
            readonly limitations: readonly string[];
        };
    }>;
    /**
     * The first comparison's difference with its bound, margin and flips; absent when the measure has
     * no comparison.
     */
    readonly difference?: {
        readonly estimate: string;
        readonly bound: string;
        readonly margin: string;
        readonly method: string;
        readonly sidedness: string;
        readonly level: number;
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
    /** Block counts and descriptive variance from the decision. */
    readonly blocks?: Decision["measures"][number]["blocks"];
    /** Within-case, between-block and across-case variance. */
    readonly noise?: Omit<DecisionNoise, "arms"> & {
        readonly arms: ReadonlyArray<Omit<DecisionNoise["arms"][number], "arm"> & {
            readonly arm: string;
        }>;
    };
    /** The measure's notes from the decision. */
    readonly notes: readonly string[];
}
/** One row of the power statement. */
export interface PowerRow {
    /** `planning` for the plan's statement, made before any call; `this run` for the run-time one. */
    readonly statement: "planning" | "this run";
    /** The measure's ID. */
    readonly measure: string;
    /** The number of applicable cases. */
    readonly cases: number;
    /** The trials per case and arm. */
    readonly replicates: number;
    /** The zero-noise floor in percentage points, or a dash when the entry was not computed. */
    readonly floor: string;
    /** The minimum detectable effect in percentage points, or `not computed`. */
    readonly mde: string;
    /** The margin in percentage points. */
    readonly margin: string;
    /** Whether the margin is within reach of the minimum detectable effect, or why it is unknown. */
    readonly reach: string;
    /** The assumption behind a computed entry, or the reason an entry was not computed. */
    readonly assumption: string;
}
/** One imputation of the sensitivity analysis for one measure. */
export interface SensitivityRow {
    /** The measure's ID. */
    readonly measure: string;
    /** How the missing trials were imputed, in words. */
    readonly imputation: string;
    /** The difference in percentage points, or a dash when there is no interval. */
    readonly difference: string;
    /**
     * The one-sided lower bound, labelled when it is not validated, or a dash when there is no
     * interval.
     */
    readonly bound: string;
    /** Whether the bound is validated, as in `MeasureRow`. */
    readonly validated: boolean;
    /** The measure's verdict under this imputation. */
    readonly verdict: string;
    /** `yes` when the imputation changes the measure's verdict, otherwise `no`. */
    readonly changes: string;
}
/** The view model of a decision. Every output renders from it, so they show the same numbers. */
export interface DecisionView {
    /** The report's title, which names the suite. */
    readonly title: string;
    /** The run's verdict, or `ESTIMATE-ONLY` when the decision gives none. */
    readonly verdict: string;
    /** What the verdict is about, shown next to it, for example "on these 12 cases". */
    readonly claim: string;
    /** Why the run has its verdict. */
    readonly reason: string;
    /** How the verdict was reached: estimand, bounds and adjustments. */
    readonly method: string;
    /** One row for each measure. */
    readonly measures: readonly MeasureRow[];
    /** Registered case reductions. The entries are point estimates without intervals. */
    readonly trialReduction?: {
        readonly measure: string;
        readonly k: number;
        readonly rows: ReadonlyArray<readonly [string, string, string, string, string]>;
    };
    /** Cases flagged by detectors, counts, and recorded independence evidence. */
    readonly mustNever?: readonly {
        readonly measure: string;
        readonly note: string;
        readonly counts: readonly [number, number, number, number];
        readonly details: readonly string[];
    }[];
    /** Each hard gate with its result: `passed`, or `failed` with the number of failures. */
    readonly gates: ReadonlyArray<{
        readonly gate: string;
        readonly result: string;
    }>;
    /**
     * The cases whose binary outcome changed between the arms, from each measure's first comparison.
     */
    readonly flips: ReadonlyArray<{
        readonly measure: string;
        readonly case: string;
        readonly direction: string;
        readonly base: string;
        readonly candidate: string;
    }>;
    /** The planning power rows, then the run-time ones. */
    readonly power: readonly PowerRow[];
    /** The block-resolution estimates, with the model and any unavailability reason. */
    readonly resolution: readonly string[];
    /** The rows of the sensitivity analysis for missing trials. */
    readonly sensitivity: readonly SensitivityRow[];
    /** The missing trials of each arm and the outcome of the sensitivity analysis, in words. */
    readonly missingness: string;
    /** The keys of the configuration factors in which the base and candidate arms differ. */
    readonly differingFactors: readonly string[];
    /** The decision's limitations. */
    readonly limitations: readonly string[];
    /**
     * Label and value pairs that identify the run, its plan, arms, measures, plugins, seed and
     * version.
     */
    readonly lineage: ReadonlyArray<readonly [string, string]>;
}
/** The label of a bound that its comparison's non-inferiority result does not vouch for. */
export declare const NOT_VALIDATED = "(not validated)";
/** The start of a bound cell that has no bound; its reason follows in parentheses. */
export declare const NO_BOUND = "no bound";
/** Why a difference has no bound, in words, from what the record says about it. */
export declare function noBoundReason(difference: Decision["measures"][number]["comparisons"][number]["difference"]): string;
/** How `decisionView` builds the view. */
export interface DecisionViewOptions {
    /**
     * True for the view that the report lint reads: every identifier, where the view inserts it or
     * the decision quotes it, becomes `id`, so a case or arm named "significant" cannot block a
     * report. Numbers and Ichnaea's own prose stay as they are, so the lint still judges them.
     */
    readonly neutral?: boolean;
}
/**
 * Builds the view model from a decision record alone. It computes nothing new: every number comes
 * from the record (REQ-82, REQ-128).
 */
export declare function decisionView(decision: Decision, suite: string, lineage?: Run["lineage"], options?: DecisionViewOptions): DecisionView;
export {};
//# sourceMappingURL=view.d.ts.map