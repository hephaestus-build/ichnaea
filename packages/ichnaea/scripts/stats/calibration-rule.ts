// The judge calibration rule as the design states it today, and the context shown beside it. It is
// the rule that the study (calibration-rule-study.ts) receives as a parameter. When the calibration
// code exists, the study's entry imports the rule from there instead, and this file goes.
import { gwetAc1, krippendorffAlpha } from "../../src/stats/index.ts";

import type { CalibrationRule, RatedStudy } from "./calibration-rule-study.ts";

/** The rule's settings. */
export interface RuleSettings {
  /** The largest accepted shortfall in agreement (D): AC1 for yes/no labels, ordinal alpha for levels. */
  readonly agreementTolerance: number;
  /** The largest accepted shortfall in sensitivity and in specificity, for yes/no labels. */
  readonly rateTolerance: number;
  /** Case resamples per study. */
  readonly resamples: number;
}

export const DEFAULT_SETTINGS: RuleSettings = {
  agreementTolerance: 0.15,
  rateTolerance: 0.1,
  resamples: 2000,
};

/**
 * The conditions this rule reports, all status conditions:
 * - yes/no judges: `ac1` (the agreement gap D with AC1), `sensitivity` and `specificity`;
 * - level judges: `alphaOrdinal` (the agreement gap D with ordinal alpha).
 * Alpha's absolute benchmarks (0.667, 0.800) are context only and are never applied here.
 */
export const CONDITIONS = ["sensitivity", "specificity", "ac1", "alphaOrdinal"] as const;

/** R's type-7 quantile of a sorted array. */
function quantile(sorted: readonly number[], p: number): number {
  const h = (sorted.length - 1) * p;
  const low = Math.floor(h);
  const high = Math.min(low + 1, sorted.length - 1);
  return sorted[low]! + (h - low) * (sorted[high]! - sorted[low]!);
}

/** The share of `reference`'s positives (or negatives) that `reader` also marks so. NaN if there are none. */
function rate(
  reader: readonly number[],
  reference: readonly number[],
  items: readonly number[],
  of: 0 | 1,
): number {
  let base = 0;
  let hit = 0;
  for (const i of items) {
    if (reference[i] !== of) continue;
    base += 1;
    if (reader[i] === of) hit += 1;
  }
  return base === 0 ? Number.NaN : hit / base;
}

function ac1(x: readonly number[], y: readonly number[], items: readonly number[]): number {
  const table = [
    [0, 0],
    [0, 0],
  ];
  for (const i of items) table[x[i]!]![y[i]!]! += 1;
  return gwetAc1(table);
}

function alpha(x: readonly number[], y: readonly number[], items: readonly number[]): number {
  return krippendorffAlpha(
    items.map((i) => [x[i]!, y[i]!]),
    "ordinal",
  );
}

type Pairwise = (x: readonly number[], y: readonly number[], items: readonly number[]) => number;

/**
 * Judge against each rater (their mean) minus each rater against the other (their mean). For a
 * directional statistic such as sensitivity, the reference is the second argument, so the
 * rater–rater value is the mean of rater 2 against rater 1 and rater 1 against rater 2.
 */
function gap(study: RatedStudy, statistic: Pairwise, items: readonly number[]): number {
  const judge =
    (statistic(study.judge, study.first, items) + statistic(study.judge, study.second, items)) / 2;
  const raters =
    (statistic(study.second, study.first, items) + statistic(study.first, study.second, items)) / 2;
  return judge - raters;
}

/** Sensitivity and specificity of `x` against the reference `y`. */
const sensitivity: Pairwise = (x, y, items) => rate(x, y, items, 1);
const specificity: Pairwise = (x, y, items) => rate(x, y, items, 0);

/** True when the one-sided 95 % lower bound of the gaps is at least −tolerance. */
function holds(gaps: readonly number[], tolerance: number): boolean {
  const sorted = gaps.filter((g) => !Number.isNaN(g)).toSorted((a, b) => a - b);
  return sorted.length > 0 && quantile(sorted, 0.05) >= -tolerance;
}

/**
 * The rule:
 * - yes/no judges pass when the one-sided 95 % lower bound of the AC1 gap D is at least
 *   −agreementTolerance, and the lower bounds of the sensitivity gap and of the specificity gap are
 *   each at least −rateTolerance;
 * - level judges pass when the lower bound of the ordinal alpha gap D is at least −agreementTolerance;
 * - the arm bias is b_c = (J₂ − J₁) − (H̄₂ − H̄₁) per case, on [0, 1], and its shown bound is
 *   max(|lower|, |upper|) of the two-sided 90 % percentile interval of its mean.
 * All come from the same resamples of whole cases. A resample in which a status statistic is
 * undefined (no positive or no negative to condition on, or an undefined alpha) is counted in
 * `nanReplicates` and left out of that statistic's quantile.
 */
export function calibrationRule(settings: RuleSettings = DEFAULT_SETTINGS): CalibrationRule {
  const evaluate: CalibrationRule["evaluate"] = (study, rng) => {
    const n = study.cases;
    const scale = study.scale === "levels" ? study.levels - 1 : 1;
    const value = (labels: readonly number[], i: number): number =>
      study.scale === "levels" ? (labels[i]! - 1) / scale : labels[i]!;
    const caseBias = Array.from({ length: n }, (_, c) => {
      const [base, candidate] = [2 * c, 2 * c + 1];
      const judgeChange = value(study.judge, candidate) - value(study.judge, base);
      const raterChange =
        (value(study.first, candidate) + value(study.second, candidate)) / 2 -
        (value(study.first, base) + value(study.second, base)) / 2;
      return judgeChange - raterChange;
    });
    const armBias = caseBias.reduce((a, b) => a + b, 0) / n;

    const statistics: Record<string, Pairwise> =
      study.scale === "levels" ? { alphaOrdinal: alpha } : { sensitivity, specificity, ac1 };
    const status =
      study.scale === "levels" ? ["alphaOrdinal"] : ["ac1", "sensitivity", "specificity"];
    const tolerance = (name: string): number =>
      name === "sensitivity" || name === "specificity"
        ? settings.rateTolerance
        : settings.agreementTolerance;
    const gaps: Record<string, number[]> = Object.fromEntries(
      Object.keys(statistics).map((k) => [k, []]),
    );

    const biases: number[] = [];
    let nanReplicates = 0;
    const items = Array.from<number>({ length: 2 * n });
    for (let r = 0; r < settings.resamples; r++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        const c = Math.floor(rng.uniform() * n);
        items[2 * k] = 2 * c;
        items[2 * k + 1] = 2 * c + 1;
        sum += caseBias[c]!;
      }
      biases.push(sum / n);
      let undefinedStatus = false;
      for (const [name, statistic] of Object.entries(statistics)) {
        const g = gap(study, statistic, items);
        gaps[name]!.push(g);
        if (Number.isNaN(g) && status.includes(name)) undefinedStatus = true;
      }
      if (undefinedStatus) nanReplicates += 1;
    }
    const conditions = Object.fromEntries(
      Object.entries(gaps).map(([name, values]) => [name, holds(values, tolerance(name))]),
    );
    const sortedBiases = biases.toSorted((a, b) => a - b);
    const lower = quantile(sortedBiases, 0.05);
    const upper = quantile(sortedBiases, 0.95);
    return {
      pass: status.every((name) => conditions[name] === true),
      conditions,
      shownBound: Math.max(Math.abs(lower), Math.abs(upper)),
      armBias,
      nanReplicates,
      replicates: settings.resamples,
    };
  };
  return { conditions: CONDITIONS, evaluate };
}
