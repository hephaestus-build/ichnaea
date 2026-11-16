import { createRng } from "../stats/index.ts";
import {
  bootstrapCalibration,
  calibrated,
  estimates,
  type ArmBias,
  type ConditionResult,
  type Slope,
} from "./engine.ts";
import type { LabelColumns } from "./statistics.ts";

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
export type CalibrationInput =
  | { readonly scale: "binary"; readonly units: readonly CalibrationUnit[] }
  | {
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
  readonly raterFloor?: { readonly ac1: number; readonly alpha: number };
  /** The bias gate's equivalence margin. Default ±0.20 (yes/no) and ±0.15 (levels). */
  readonly armBiasMargin?: { readonly binary: number; readonly levels: number };
  /** Item resamples. Default 2,000. */
  readonly resamples?: number;
  /** The seed of the resampling stream. */
  readonly seed: number;
}

/** The registered rule's defaults. */
export const CALIBRATION_DEFAULTS: {
  readonly agreementTolerance: 0.15;
  readonly rateTolerance: 0.1;
  readonly raterFloor: { readonly ac1: 0.6; readonly alpha: 0.667 };
  readonly armBiasMargin: { readonly binary: 0.2; readonly levels: 0.15 };
  readonly resamples: 2000;
} = {
  agreementTolerance: 0.15,
  rateTolerance: 0.1,
  raterFloor: { ac1: 0.6, alpha: 0.667 },
  armBiasMargin: { binary: 0.2, levels: 0.15 },
  resamples: 2000,
};

/** A condition of the calibration rule. */
export type CalibrationCondition =
  | "ratersFloor"
  | "agreement"
  | "sensitivity"
  | "specificity"
  | "armBias";

/** An estimate of the judge against people and of people against each other. */
export interface PairedRate {
  /** The judge against each rater, the mean of the two. */
  readonly judge: number;
  /** Each rater against the other, the mean of the two directions. */
  readonly humanHuman: number;
  /** judge − humanHuman, and its one-sided 95 % lower bound. */
  readonly gap: { readonly estimate: number; readonly lower: number };
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
  readonly humanHuman: { readonly estimate: number; readonly lower: number };
  /** The judge against each rater, the mean of the two. */
  readonly judgeHuman: { readonly estimate: number };
  /** D = judgeHuman − humanHuman, with its one-sided 95 % lower bound. */
  readonly difference: { readonly estimate: number; readonly lower: number };
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
    readonly ratersFloor: ConditionResult & { readonly floor: number };
    readonly agreement: ConditionResult & { readonly tolerance: number };
    readonly sensitivity?: ConditionResult & { readonly tolerance: number };
    readonly specificity?: ConditionResult & { readonly tolerance: number };
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

const CONFIGURATIONS = { base: 0, candidate: 1, "known-worse": 2 } as const;

/** The set in columns, after checking it. */
function columns(input: CalibrationInput): LabelColumns {
  const levels = input.scale === "levels" ? input.levels : 2;
  if (input.scale === "levels" && !(Number.isInteger(levels) && levels >= 2)) {
    throw new RangeError(`levels must be an integer of at least 2, got ${levels}`);
  }
  const valid = (label: number): boolean =>
    input.scale === "binary"
      ? label === 0 || label === 1
      : Number.isInteger(label) && label >= 1 && label <= levels;
  const items = new Map<string, number>();
  const strata = new Map<string, number>();
  const stratumOf: number[] = [];
  const stratumName: string[] = [];
  const seen = new Set<number>();
  for (const unit of input.units) {
    if (!(Number.isFinite(unit.weight) && unit.weight >= 1)) {
      throw new RangeError(`${unit.item}: a weight is 1/π, at least 1, got ${unit.weight}`);
    }
    if (input.scale === "levels" && unit.weight !== 1) {
      throw new RangeError(
        `${unit.item}: levels take no weight other than 1, because ordinal alpha takes none`,
      );
    }
    for (const label of [...unit.raters, unit.judge]) {
      if (!valid(label))
        throw new RangeError(`${unit.item}: the label ${label} is outside the scale`);
    }
    if (!items.has(unit.item)) {
      items.set(unit.item, items.size);
      if (!strata.has(unit.stratum)) strata.set(unit.stratum, strata.size);
      stratumOf.push(strata.get(unit.stratum)!);
      stratumName.push(unit.stratum);
    } else if (stratumName[items.get(unit.item)!] !== unit.stratum) {
      throw new RangeError(`${unit.item}: every answer of an item is in one stratum`);
    }
    seen.add(CONFIGURATIONS[unit.configuration]);
  }
  if (!seen.has(0) || !seen.has(1)) {
    throw new RangeError("a calibration set needs answers from both base and candidate");
  }
  return {
    scale: input.scale,
    levels,
    cases: items.size,
    caseOf: input.units.map((u) => items.get(u.item)!),
    configurationOf: input.units.map((u) => CONFIGURATIONS[u.configuration]),
    weight: input.units.map((u) => u.weight),
    stratumOf,
    first: input.units.map((u) => u.raters[0]),
    second: input.units.map((u) => u.raters[1]),
    judge: input.units.map((u) => u.judge),
  };
}

/** A rate of the judge and of the raters, with the gap's bound, when the scale has it. */
function paired(
  estimate: { readonly judge: number; readonly humanHuman: number } | undefined,
  condition: ConditionResult | undefined,
): PairedRate | undefined {
  return estimate === undefined || condition === undefined
    ? undefined
    : {
        ...estimate,
        gap: { estimate: estimate.judge - estimate.humanHuman, lower: condition.lower },
      };
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
export function analyzeCalibration(
  input: CalibrationInput,
  settings: CalibrationSettings,
): CalibrationAnalysis {
  const values = {
    agreementTolerance: settings.agreementTolerance ?? CALIBRATION_DEFAULTS.agreementTolerance,
    rateTolerance: settings.rateTolerance ?? CALIBRATION_DEFAULTS.rateTolerance,
    raterFloor: settings.raterFloor ?? CALIBRATION_DEFAULTS.raterFloor,
    armBiasMargin: settings.armBiasMargin ?? CALIBRATION_DEFAULTS.armBiasMargin,
    resamples: settings.resamples ?? CALIBRATION_DEFAULTS.resamples,
  };
  if (!(Number.isInteger(values.resamples) && values.resamples >= 1)) {
    throw new RangeError(`resamples must be a positive integer, got ${values.resamples}`);
  }
  const set = columns(input);
  const boot = bootstrapCalibration(set, values, createRng(settings.seed));
  const point = estimates(set);
  const sum = set.weight.reduce((a, w) => a + w, 0);
  const sumSquares = set.weight.reduce((a, w) => a + w * w, 0);
  const c = boot.conditions;
  const conditions: CalibrationAnalysis["conditions"] = {
    ratersFloor: {
      ...c.ratersFloor,
      floor: values.raterFloor[set.scale === "levels" ? "alpha" : "ac1"],
    },
    agreement: { ...c.agreement!, tolerance: values.agreementTolerance },
    ...(c.sensitivity === undefined
      ? {}
      : { sensitivity: { ...c.sensitivity, tolerance: values.rateTolerance } }),
    ...(c.specificity === undefined
      ? {}
      : { specificity: { ...c.specificity, tolerance: values.rateTolerance } }),
    armBias: {
      ...c.armBias,
      shownBound: boot.armBias.shownBound,
      margin: values.armBiasMargin[set.scale === "levels" ? "levels" : "binary"],
    },
  };
  const order: readonly CalibrationCondition[] = [
    "ratersFloor",
    "agreement",
    "sensitivity",
    "specificity",
    "armBias",
  ];
  const failed = order.filter((name) => conditions[name] !== undefined && !conditions[name].holds);
  const sensitivity = paired(point.sensitivity, c.sensitivity);
  const specificity = paired(point.specificity, c.specificity);
  return {
    statistic: set.scale === "levels" ? "krippendorff-alpha-ordinal" : "gwet-ac1",
    units: set.caseOf.length,
    items: set.cases,
    effectiveUnits: (sum * sum) / sumSquares,
    humanHuman: { estimate: point.humanHuman, lower: c.ratersFloor.lower },
    judgeHuman: { estimate: point.judgeHuman },
    difference: { estimate: point.judgeHuman - point.humanHuman, lower: c.agreement!.lower },
    ...(sensitivity === undefined ? {} : { sensitivity }),
    ...(specificity === undefined ? {} : { specificity }),
    armBias: boot.armBias,
    ...(boot.slope === undefined
      ? {}
      : { slope: { ...boot.slope, dropShown: boot.slope.humanChangeUpper < 0 } }),
    conditions,
    status: calibrated(boot) ? "calibrated" : "diagnostic",
    failed,
    use: "secondary",
    undefinedResamples: boot.undefinedResamples,
    resamples: values.resamples,
  };
}

/**
 * Whether a judge-based Pass is reachable at a measure's limit, and the bound it would need. A Pass
 * needs the judge-measured change's lower bound to be at least −(β_L · limit − B), with β_L the
 * slope's lower bound and B the bias bound on the calibration's base against known-worse pair. It
 * is not reachable when β_L · limit ≤ B, when the human drop is not shown, or without known-worse
 * answers. Even when it is reachable, a calibrated judge's measures stay secondary.
 */
export function judgePass(
  analysis: CalibrationAnalysis,
  limit: number,
): { readonly reachable: boolean; readonly lowerBoundAtLeast: number | undefined } {
  const slope = analysis.slope;
  if (slope === undefined) return { reachable: false, lowerBoundAtLeast: undefined };
  const margin = slope.lower * limit - slope.pairBound;
  return { reachable: slope.dropShown && margin > 0, lowerBoundAtLeast: -margin };
}
