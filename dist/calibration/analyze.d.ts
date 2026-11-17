import { type ArmBias, type ConditionResult, type Slope } from "./engine.ts";
/** One labelled answer of a calibration set. */
export interface CalibrationUnit {
    /** The item the answer belongs to: the bootstrap resamples whole items. */
    readonly item: string;
    /** The item's sampling stratum. Every answer of an item names the same one. */
    readonly stratum: string;
    /** The configuration that produced the answer. `known-worse` is the calibration's own worse arm. */
    readonly configuration: "base" | "candidate" | "known-worse";
    /** 1/π, the inverse of the answer's inclusion probability; 1 when every answer was labelled. */
    readonly weight: number;
    /** The two raters' labels. */
    readonly raters: readonly [number, number];
    /** The judge's label. */
    readonly judge: number;
}
/** A calibration set: yes/no labels (1 marks a defect), or levels 1 to `levels`. */
export type CalibrationInput = {
    readonly scale: "binary";
    readonly units: readonly CalibrationUnit[];
} | {
    readonly scale: "levels";
    readonly levels: number;
    readonly units: readonly CalibrationUnit[];
};
/** The calibration rule's values, each with its default. */
export interface CalibrationSettings {
    /** The largest accepted shortfall in agreement, D. Default 0.15. */
    readonly agreementTolerance?: number;
    /** The largest accepted shortfall in sensitivity and in specificity (yes/no). Default 0.10. */
    readonly rateTolerance?: number;
    /** The rater floor. Default AC1 0.60 (yes/no) and ordinal alpha 0.667 (levels). */
    readonly raterFloor?: {
        readonly ac1: number;
        readonly alpha: number;
    };
    /** The bias gate's equivalence margin. Default ±0.20 (yes/no) and ±0.15 (levels). */
    readonly armBiasMargin?: {
        readonly binary: number;
        readonly levels: number;
    };
    /** Item resamples. Default 2,000. */
    readonly resamples?: number;
    /** The seed of the resampling stream. */
    readonly seed: number;
}
/** The registered rule's defaults. */
export declare const CALIBRATION_DEFAULTS: {
    readonly agreementTolerance: 0.15;
    readonly rateTolerance: 0.1;
    readonly raterFloor: {
        readonly ac1: 0.6;
        readonly alpha: 0.667;
    };
    readonly armBiasMargin: {
        readonly binary: 0.2;
        readonly levels: 0.15;
    };
    readonly resamples: 2000;
};
/** A condition of the calibration rule. */
export type CalibrationCondition = "ratersFloor" | "agreement" | "sensitivity" | "specificity" | "armBias";
/** An estimate of the judge against people and of people against each other. */
export interface PairedRate {
    /** The judge against each rater, the mean of the two. */
    readonly judge: number;
    /** Each rater against the other, the mean of the two directions. */
    readonly humanHuman: number;
    /** judge − humanHuman, and its one-sided 95 % lower bound. */
    readonly gap: {
        readonly estimate: number;
        readonly lower: number;
    };
}
/** What a calibration set shows about a judge. Every bound comes from one item-cluster bootstrap. */
export interface CalibrationAnalysis {
    /** The agreement statistic of D: Gwet's AC1 for yes/no labels, ordinal alpha for levels. */
    readonly statistic: "gwet-ac1" | "krippendorff-alpha-ordinal";
    /** The number of answers. */
    readonly units: number;
    /** The number of items. */
    readonly items: number;
    /** Kish's effective number of answers, (Σw)²/Σw². */
    readonly effectiveUnits: number;
    /** Rater against rater agreement, with its one-sided 95 % lower bound. */
    readonly humanHuman: {
        readonly estimate: number;
        readonly lower: number;
    };
    /** The judge against each rater, the mean of the two. */
    readonly judgeHuman: {
        readonly estimate: number;
    };
    /** D = judgeHuman − humanHuman, with its one-sided 95 % lower bound. */
    readonly difference: {
        readonly estimate: number;
        readonly lower: number;
    };
    /** Weighted sensitivity, for yes/no labels. */
    readonly sensitivity?: PairedRate;
    /** Weighted specificity, for yes/no labels. */
    readonly specificity?: PairedRate;
    /** The judge's bias between base and candidate, on [0, 1], with its 90 % interval. */
    readonly armBias: ArmBias;
    /** The judge's slope on the base against known-worse pair, with yes/no labels and known-worse answers. */
    readonly slope?: Slope & {
        /** Whether the human-rated drop is shown: its one-sided 95 % upper bound is below 0. */
        readonly dropShown: boolean;
    };
    /** Each condition of the rule, with the bound it was read from and its threshold. */
    readonly conditions: {
        readonly ratersFloor: ConditionResult & {
            readonly floor: number;
        };
        readonly agreement: ConditionResult & {
            readonly tolerance: number;
        };
        readonly sensitivity?: ConditionResult & {
            readonly tolerance: number;
        };
        readonly specificity?: ConditionResult & {
            readonly tolerance: number;
        };
        /** The bias gate: armBias.shownBound is at most the margin. The known-worse pair takes no part. */
        readonly armBias: {
            readonly holds: boolean;
            readonly shownBound: number;
            readonly margin: number;
        };
    };
    /** `calibrated` when every condition holds, else `diagnostic`. */
    readonly status: "calibrated" | "diagnostic";
    /** The conditions that do not hold, in the rule's order. */
    readonly failed: readonly CalibrationCondition[];
    /** How a calibrated judge's measures may be used: as secondary measures only. */
    readonly use: "secondary";
    /** Resamples in which a status statistic was undefined: counted, never dropped silently. */
    readonly undefinedResamples: number;
    /** All resamples. */
    readonly resamples: number;
}
/**
 * Analyzes a calibration set under the calibration rule. A judge is `calibrated` when every
 * condition holds:
 * - the rater floor: the lower bound of rater–rater agreement reaches AC1 0.60 (yes/no) or ordinal
 *   alpha 0.667 (levels);
 * - D: the lower bound of judge–rater minus rater–rater agreement is at least −0.15;
 * - for yes/no labels, the lower bounds of the sensitivity gap and of the specificity gap are each
 *   at least −0.10;
 * - the bias gate: the 90 % interval of the judge's bias between base and candidate lies within
 *   ±0.20 (yes/no) or ±0.15 (levels). A judge whose bias between the two is not ruled out makes
 *   its measured changes uninterpretable, so the gate holds for a secondary measure too.
 * Lower bounds are one-sided 95 % percentile bounds of a bootstrap that resamples whole items within
 * their strata, and every statistic weights each answer by 1/π. A calibrated judge's measures are
 * secondary: they are shown and never decide.
 */
export declare function analyzeCalibration(input: CalibrationInput, settings: CalibrationSettings): CalibrationAnalysis;
/** Why a judge-based Pass is not reachable. */
export type PassBlocker = "notCalibrated" | "unsupportedScale" | "noKnownWorse" | "dropNotShown" | "slopeNotShown";
/** Whether a judge-based Pass is reachable at a limit. */
export interface JudgePass {
    /** True when nothing blocks it. */
    readonly reachable: boolean;
    /** −(β_L · limit − B): the judge-measured change's lower bound must be at least this. */
    readonly lowerBoundAtLeast: number | undefined;
    /**
     * Every reason that blocks it, in this order: notCalibrated, unsupportedScale, noKnownWorse,
     * dropNotShown, slopeNotShown.
     */
    readonly blockedBy: readonly PassBlocker[];
}
/**
 * Whether a judge-based Pass is reachable at a measure's limit, and the bound it would need. A Pass
 * needs the judge-measured change's lower bound to be at least −(β_L · limit − B), with β_L the
 * slope's lower bound and B the bias bound on the calibration's base against known-worse pair. It
 * is blocked when the judge is not calibrated, for levels (the slope needs yes/no labels, so no
 * known-worse answers can unblock it), without known-worse answers, when the human drop on that
 * pair is not shown, or when β_L · limit ≤ B. Even when it is reachable, a calibrated judge's
 * measures stay secondary in this version.
 */
export declare function judgePass(analysis: CalibrationAnalysis, limit: number): JudgePass;
//# sourceMappingURL=analyze.d.ts.map