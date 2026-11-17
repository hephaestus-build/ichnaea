// The calibration rule on a set in columns: one item-cluster bootstrap within strata gives every
// bound. The analysis (analyze.ts) and the rule's operating-characteristics study
// (scripts/stats/calibration-rule-study.ts) both run it.
import type { Rng } from "../stats/rng.ts";
import {
  armBias,
  gap,
  humanHuman,
  judgeHuman,
  ordinalAlpha,
  pairChange,
  quantile,
  sensitivity,
  sorted,
  specificity,
  valueOf,
  weightedAc1,
  type LabelColumns,
  type Pairwise,
} from "./statistics.ts";

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
  readonly raterFloor: { readonly ac1: number; readonly alpha: number };
  /**
   * The equivalence margin of the bias between base and candidate, on [0, 1]: its 90 % interval
   * must lie within ±margin.
   */
  readonly armBiasMargin: { readonly binary: number; readonly levels: number };
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
    readonly armBias: { readonly holds: boolean };
  } & Partial<Record<StatusStatistic, ConditionResult>>;
  /** The bias between base and candidate. */
  readonly armBias: ArmBias;
  /** The slope, when the set has known-worse answers and yes/no labels. */
  readonly slope?: Slope;
  /** Resamples in which a status statistic was undefined: counted, never dropped silently. */
  readonly undefinedResamples: number;
}

/** The status statistics of a scale, by name. */
export function statusStatistics(
  scale: LabelColumns["scale"],
): Partial<Record<StatusStatistic, Pairwise>> {
  return scale === "levels"
    ? { agreement: ordinalAlpha }
    : { agreement: weightedAc1, sensitivity, specificity };
}

/** The agreement statistic of a scale. */
export function agreementStatistic(scale: LabelColumns["scale"]): Pairwise {
  return scale === "levels" ? ordinalAlpha : weightedAc1;
}

/** A gap condition: the lower bound of the gaps is at least −tolerance. */
function gapCondition(gaps: readonly number[], tolerance: number): ConditionResult {
  const values = sorted(gaps);
  const lower = values.length > 0 ? quantile(values, 0.05) : Number.NaN;
  return { holds: values.length > 0 && lower >= -tolerance, lower };
}

/**
 * Runs the bootstrap: each resample draws, within each stratum, as many items as it has, with
 * replacement, and takes all their answers. A resample in which a status statistic is undefined
 * (no defect or no non-defect to condition on, or an undefined alpha) is counted and left out of
 * that statistic's quantile.
 */
export function bootstrapCalibration(set: LabelColumns, values: RuleValues, rng: Rng): Bootstrap {
  const value = valueOf(set);
  const answersOf: number[][] = Array.from({ length: set.cases }, () => []);
  set.caseOf.forEach((c, i) => answersOf[c]!.push(i));
  const strata = new Map<number, number[]>();
  set.stratumOf.forEach((s, c) => {
    if (!strata.has(s)) strata.set(s, []);
    strata.get(s)!.push(c);
  });
  const all = set.caseOf.map((_, i) => i);

  const statistics = statusStatistics(set.scale);
  const tolerance = (name: string): number =>
    name === "sensitivity" || name === "specificity"
      ? values.rateTolerance
      : values.agreementTolerance;
  const gaps: Record<string, number[]> = Object.fromEntries(
    Object.keys(statistics).map((k) => [k, []]),
  );
  const biases: number[] = [];
  const raterAgreement: number[] = [];
  const raterStatistic = agreementStatistic(set.scale);
  const floor = values.raterFloor[set.scale === "levels" ? "alpha" : "ac1"];
  const hasPair = set.scale === "binary" && set.configurationOf.includes(2);
  const judgeLabel = (i: number): number => set.judge[i]!;
  const raterLabel = (i: number): number => (set.first[i]! + set.second[i]!) / 2;
  const slopes: number[] = [];
  const humanChanges: number[] = [];
  const pairBiases: number[] = [];
  let undefinedResamples = 0;
  for (let r = 0; r < values.resamples; r++) {
    const answers: number[] = [];
    for (const cases of strata.values()) {
      for (let k = 0; k < cases.length; k++) {
        answers.push(...answersOf[cases[Math.floor(rng.uniform() * cases.length)]!]!);
      }
    }
    biases.push(armBias(set, answers, value));
    raterAgreement.push(raterStatistic(set.first, set.second, answers, set.weight));
    if (hasPair) {
      const human = pairChange(set, answers, raterLabel);
      const judgeChange = pairChange(set, answers, judgeLabel);
      humanChanges.push(human);
      slopes.push(judgeChange / human);
      pairBiases.push(judgeChange - human);
    }
    let undefinedStatus = false;
    for (const [name, statistic] of Object.entries(statistics)) {
      const g = gap(set, statistic, answers);
      gaps[name]!.push(g);
      if (Number.isNaN(g)) undefinedStatus = true;
    }
    if (undefinedStatus) undefinedResamples += 1;
  }

  const agreements = sorted(raterAgreement);
  const floorLower = agreements.length > 0 ? quantile(agreements, 0.05) : Number.NaN;
  const sortedBiases = biases.filter((x) => !Number.isNaN(x)).toSorted((x, y) => x - y);
  const lower90 = quantile(sortedBiases, 0.05);
  const upper90 = quantile(sortedBiases, 0.95);
  const slope = hasPair
    ? ((): Slope => {
        const pair = sorted(pairBiases);
        const human = pairChange(set, all, raterLabel);
        return {
          estimate: pairChange(set, all, judgeLabel) / human,
          lower: Math.min(1, quantile(sorted(slopes), 0.05)),
          humanChange: human,
          humanChangeUpper: quantile(sorted(humanChanges), 0.95),
          pairBound: Math.max(Math.abs(quantile(pair, 0.05)), Math.abs(quantile(pair, 0.95))),
        };
      })()
    : undefined;
  const shownBound = Math.max(Math.abs(lower90), Math.abs(upper90));
  const margin = values.armBiasMargin[set.scale === "levels" ? "levels" : "binary"];
  return {
    conditions: {
      ratersFloor: { holds: agreements.length > 0 && floorLower >= floor, lower: floorLower },
      armBias: { holds: shownBound <= margin },
      ...Object.fromEntries(
        Object.entries(gaps).map(([name, g]) => [name, gapCondition(g, tolerance(name))]),
      ),
    },
    armBias: {
      estimate: armBias(set, all, value),
      lower90,
      upper90,
      shownBound,
    },
    ...(slope === undefined ? {} : { slope }),
    undefinedResamples,
  };
}

/** Whether every condition of the bootstrap holds: the judge is calibrated. */
export function calibrated(boot: Bootstrap): boolean {
  return Object.values(boot.conditions).every((condition) => condition.holds);
}

/** The point estimates on the whole set. */
export function estimates(set: LabelColumns): {
  readonly humanHuman: number;
  readonly judgeHuman: number;
  readonly sensitivity?: { readonly judge: number; readonly humanHuman: number };
  readonly specificity?: { readonly judge: number; readonly humanHuman: number };
} {
  const all = set.caseOf.map((_, i) => i);
  const agreement = agreementStatistic(set.scale);
  const pair = (statistic: Pairwise): { judge: number; humanHuman: number } => ({
    judge: judgeHuman(set, statistic, all),
    humanHuman: humanHuman(set, statistic, all),
  });
  return {
    humanHuman: agreement(set.first, set.second, all, set.weight),
    judgeHuman: judgeHuman(set, agreement, all),
    ...(set.scale === "binary"
      ? { sensitivity: pair(sensitivity), specificity: pair(specificity) }
      : {}),
  };
}
