// The judge calibration rule as the design states it today. It is the rule that the study
// (calibration-rule-study.ts) receives as a parameter. When the calibration code exists, the study's
// entry imports the rule from there instead, and this file goes.
import { krippendorffAlpha } from "../../src/stats/index.ts";

import type { CalibrationRule, RatedStudy } from "./calibration-rule-study.ts";

/** The rule's settings. */
export interface RuleSettings {
  /** The largest accepted shortfall in agreement (D): AC1 for yes/no labels, ordinal alpha for levels. */
  readonly agreementTolerance: number;
  /** The largest accepted shortfall in sensitivity and in specificity, for yes/no labels. */
  readonly rateTolerance: number;
  /** Case resamples per study. */
  readonly resamples: number;
  /**
   * The rater floor, a precondition: the one-sided 95 % lower bound of rater–rater agreement must
   * reach it (AC1 for yes/no labels, ordinal alpha for levels).
   */
  readonly raterFloor?: { readonly ac1: number; readonly alpha: number };
  /**
   * The equivalence margin of the bias between base and candidate: its 90 % interval must lie
   * within ±margin (yes/no labels, and levels normalized to [0, 1]).
   */
  readonly armBiasMargin?: { readonly binary: number; readonly levels: number };
}

/** The registered rater floor: AC1 ≥ 0.60 (yes/no) or ordinal alpha ≥ 0.667 (levels). */
export const RATER_FLOOR = { ac1: 0.6, alpha: 0.667 } as const;

/** The registered equivalence margins of the bias between base and candidate. */
export const ARM_BIAS_MARGIN = { binary: 0.2, levels: 0.15 } as const;

export const DEFAULT_SETTINGS: RuleSettings = {
  agreementTolerance: 0.15,
  rateTolerance: 0.1,
  resamples: 2000,
};

/**
 * The conditions this rule reports, all status conditions:
 * - `ratersFloor`, the precondition: rater–rater agreement reaches RATER_FLOOR;
 * - yes/no judges: `ac1` (the agreement gap D with AC1), `sensitivity` and `specificity`;
 * - level judges: `alphaOrdinal` (the agreement gap D with ordinal alpha);
 * - `armBias`: the 90 % interval of the bias between base and candidate lies within
 *   ±ARM_BIAS_MARGIN. The known-worse configuration takes no part in it.
 * Alpha's absolute benchmark applies to the raters (the floor), never to the judge's own alpha.
 */
export const CONDITIONS = [
  "ratersFloor",
  "ac1",
  "sensitivity",
  "specificity",
  "alphaOrdinal",
  "armBias",
] as const;

/** R's type-7 quantile of a sorted array. */
function quantile(sorted: readonly number[], p: number): number {
  const h = (sorted.length - 1) * p;
  const low = Math.floor(h);
  const high = Math.min(low + 1, sorted.length - 1);
  return sorted[low]! + (h - low) * (sorted[high]! - sorted[low]!);
}

/** The answers of a resample: indices, repeated when a case is drawn more than once. */
type Answers = readonly number[];

/** A statistic of reader `x` against reference `y` over a resample's answers, with the answer weights. */
type Pairwise = (
  x: readonly number[],
  y: readonly number[],
  answers: Answers,
  w: readonly number[],
) => number;

/** The weighted share of `y`'s positives (of = 1) or negatives (of = 0) that `x` marks the same. NaN if none. */
function rate(
  x: readonly number[],
  y: readonly number[],
  answers: Answers,
  w: readonly number[],
  of: 0 | 1,
): number {
  let base = 0;
  let hit = 0;
  for (const i of answers) {
    if (y[i] !== of) continue;
    base += w[i]!;
    if (x[i] === of) hit += w[i]!;
  }
  return base === 0 ? Number.NaN : hit / base;
}

const sensitivity: Pairwise = (x, y, answers, w) => rate(x, y, answers, w, 1);
const specificity: Pairwise = (x, y, answers, w) => rate(x, y, answers, w, 0);

/**
 * Gwet's AC1 for two raters with answer weights: (p_o − p_e)/(1 − p_e), p_e = Σ π_k(1 − π_k)/(q − 1)
 * with q = 2, every count weighted. With unit weights it equals `gwetAc1` of ./stats, which takes
 * integer counts only.
 */
export const weightedAc1: Pairwise = (x, y, answers, w) => {
  let total = 0;
  let agree = 0;
  let positive = 0;
  for (const i of answers) {
    total += w[i]!;
    if (x[i] === y[i]) agree += w[i]!;
    positive += (w[i]! * (x[i]! + y[i]!)) / 2;
  }
  const po = agree / total;
  const pi = positive / total;
  const pe = 2 * pi * (1 - pi);
  return (po - pe) / (1 - pe);
};

const alpha: Pairwise = (x, y, answers) =>
  krippendorffAlpha(
    answers.map((i) => [x[i]!, y[i]!]),
    "ordinal",
  );

/**
 * Judge against each rater (their mean) minus each rater against the other (their mean). For a
 * directional statistic such as sensitivity, the reference is the second argument, so the
 * rater–rater value is the mean of rater 2 against rater 1 and rater 1 against rater 2.
 */
function gap(study: RatedStudy, statistic: Pairwise, answers: Answers): number {
  const w = study.weight;
  const judge =
    (statistic(study.judge, study.first, answers, w) +
      statistic(study.judge, study.second, answers, w)) /
    2;
  const raters =
    (statistic(study.second, study.first, answers, w) +
      statistic(study.first, study.second, answers, w)) /
    2;
  return judge - raters;
}

/** The finite values, sorted. */
const sorted = (xs: readonly number[]): number[] =>
  xs.filter((x) => Number.isFinite(x)).toSorted((x, y) => x - y);

/** True when the one-sided 95 % lower bound of the gaps is at least −tolerance. */
function holds(gaps: readonly number[], tolerance: number): boolean {
  const values = sorted(gaps);
  return values.length > 0 && quantile(values, 0.05) >= -tolerance;
}

/**
 * The bias between the two configurations: the weighted mean of (judge − the raters' mean) over the
 * second configuration's answers, minus the same over the first's, on [0, 1]. With one answer per
 * configuration per case and unit weights, it equals the mean per-case difference.
 */
function bias(
  study: RatedStudy,
  answers: Answers,
  value: (labels: readonly number[], i: number) => number,
): number {
  const sum = [0, 0];
  const weight = [0, 0];
  for (const i of answers) {
    const k = study.configurationOf[i]!;
    if (k > 1) continue;
    const d = value(study.judge, i) - (value(study.first, i) + value(study.second, i)) / 2;
    sum[k]! += study.weight[i]! * d;
    weight[k]! += study.weight[i]!;
  }
  return sum[1]! / weight[1]! - sum[0]! / weight[0]!;
}

/**
 * The weighted mean quality (1 − label) of `labels` on configuration 2 minus configuration 0: the
 * change from the base to the known-worse configuration, on yes/no labels.
 */
function pairChange(study: RatedStudy, answers: Answers, labels: (i: number) => number): number {
  const sum = [0, 0];
  const weight = [0, 0];
  for (const i of answers) {
    const k = study.configurationOf[i]!;
    if (k === 1) continue;
    const slot = k === 2 ? 1 : 0;
    sum[slot]! += study.weight[i]! * (1 - labels(i));
    weight[slot]! += study.weight[i]!;
  }
  return sum[1]! / weight[1]! - sum[0]! / weight[0]!;
}

/**
 * The rule:
 * - yes/no judges pass when the one-sided 95 % lower bound of the AC1 gap D is at least
 *   −agreementTolerance, and the lower bounds of the sensitivity gap and of the specificity gap are
 *   each at least −rateTolerance;
 * - level judges pass when the lower bound of the ordinal alpha gap D is at least −agreementTolerance;
 * - every judge needs the rater floor, and the shown bias bound, max(|lower|, |upper|) of the
 *   two-sided 90 % interval of the bias between base and candidate, at most its margin.
 * Every statistic is weighted by 1/π. The intervals come from one bootstrap that resamples whole
 * cases (items) within their strata. A resample in which a status statistic is undefined (no
 * positive or no negative to condition on, or an undefined alpha) is counted in `nanReplicates` and
 * left out of that statistic's quantile. Alpha takes no weights: level studies weight every answer 1.
 */
export function calibrationRule(settings: RuleSettings = DEFAULT_SETTINGS): CalibrationRule {
  const evaluate: CalibrationRule["evaluate"] = (study, rng) => {
    const scale = study.scale === "levels" ? study.levels - 1 : 1;
    const value = (labels: readonly number[], i: number): number =>
      study.scale === "levels" ? (labels[i]! - 1) / scale : labels[i]!;
    if (study.scale === "levels" && study.weight.some((w) => w !== 1)) {
      throw new RangeError("the ordinal alpha condition takes unweighted studies only");
    }
    const answersOf: number[][] = Array.from({ length: study.cases }, () => []);
    study.caseOf.forEach((c, i) => answersOf[c]!.push(i));
    const strata = new Map<number, number[]>();
    study.stratumOf.forEach((s, c) => {
      if (!strata.has(s)) strata.set(s, []);
      strata.get(s)!.push(c);
    });
    const armBias = bias(
      study,
      study.caseOf.map((_, i) => i),
      value,
    );

    const statistics: Record<string, Pairwise> =
      study.scale === "levels"
        ? { alphaOrdinal: alpha }
        : { ac1: weightedAc1, sensitivity, specificity };
    const status = Object.keys(statistics);
    const tolerance = (name: string): number =>
      name === "sensitivity" || name === "specificity"
        ? settings.rateTolerance
        : settings.agreementTolerance;
    const gaps: Record<string, number[]> = Object.fromEntries(status.map((k) => [k, []]));

    const biases: number[] = [];
    const raterAgreement: number[] = [];
    const raterStatistic = study.scale === "levels" ? alpha : weightedAc1;
    const floor = (settings.raterFloor ?? RATER_FLOOR)[study.scale === "levels" ? "alpha" : "ac1"];
    // The slope on the base against known-worse pair, when the study has known-worse answers.
    const hasPair = study.scale === "binary" && study.configurationOf.includes(2);
    const judgeLabel = (i: number): number => study.judge[i]!;
    const raterLabel = (i: number): number => (study.first[i]! + study.second[i]!) / 2;
    const slopes: number[] = [];
    const humanChanges: number[] = [];
    const pairBiases: number[] = [];
    let nanReplicates = 0;
    for (let r = 0; r < settings.resamples; r++) {
      const answers: number[] = [];
      for (const cases of strata.values()) {
        for (let k = 0; k < cases.length; k++) {
          answers.push(...answersOf[cases[Math.floor(rng.uniform() * cases.length)]!]!);
        }
      }
      biases.push(bias(study, answers, value));
      raterAgreement.push(raterStatistic(study.first, study.second, answers, study.weight));
      if (hasPair) {
        const human = pairChange(study, answers, raterLabel);
        const judgeChange = pairChange(study, answers, judgeLabel);
        humanChanges.push(human);
        slopes.push(judgeChange / human);
        pairBiases.push(judgeChange - human);
      }
      let undefinedStatus = false;
      for (const [name, statistic] of Object.entries(statistics)) {
        const g = gap(study, statistic, answers);
        gaps[name]!.push(g);
        if (Number.isNaN(g)) undefinedStatus = true;
      }
      if (undefinedStatus) nanReplicates += 1;
    }
    const agreements = sorted(raterAgreement);
    const conditions: Record<string, boolean> = {
      ratersFloor: agreements.length > 0 && quantile(agreements, 0.05) >= floor,
      ...Object.fromEntries(
        Object.entries(gaps).map(([name, values]) => [name, holds(values, tolerance(name))]),
      ),
    };
    const sortedBiases = biases.filter((x) => !Number.isNaN(x)).toSorted((x, y) => x - y);
    const lower = quantile(sortedBiases, 0.05);
    const upper = quantile(sortedBiases, 0.95);
    const shownBound = Math.max(Math.abs(lower), Math.abs(upper));
    conditions["armBias"] =
      shownBound <=
      (settings.armBiasMargin ?? ARM_BIAS_MARGIN)[study.scale === "levels" ? "levels" : "binary"];
    const all = study.caseOf.map((_, i) => i);
    const slope = hasPair
      ? (() => {
          const pair = sorted(pairBiases);
          const human = pairChange(study, all, raterLabel);
          return {
            estimate: pairChange(study, all, judgeLabel) / human,
            lower: Math.min(1, quantile(sorted(slopes), 0.05)),
            humanChange: human,
            humanChangeUpper: quantile(sorted(humanChanges), 0.95),
            pairBound: Math.max(Math.abs(quantile(pair, 0.05)), Math.abs(quantile(pair, 0.95))),
          };
        })()
      : undefined;
    return {
      pass: Object.values(conditions).every((held) => held),
      conditions,
      shownBound,
      armBias,
      nanReplicates,
      replicates: settings.resamples,
      ...(slope === undefined ? {} : { slope }),
    };
  };
  return { conditions: CONDITIONS, evaluate };
}
