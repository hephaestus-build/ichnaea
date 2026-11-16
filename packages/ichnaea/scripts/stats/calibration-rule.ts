// The judge calibration rule as the design states it today: the agreement condition and the arm-bias
// interval, from one case-cluster percentile bootstrap. It is the rule that the study
// (calibration-rule-study.ts) receives as a parameter. When the calibration code exists, the study's
// entry imports the rule from there instead, and this file goes.
import { gwetAc1, krippendorffAlpha } from "../../src/stats/index.ts";

import type { CalibrationRule, RatedStudy } from "./calibration-rule-study.ts";

/** The rule's settings. */
export interface RuleSettings {
  /** The largest accepted shortfall of judge–rater against rater–rater agreement. */
  readonly tolerance: number;
  /** Case resamples per study. */
  readonly resamples: number;
}

export const DEFAULT_SETTINGS: RuleSettings = { tolerance: 0.15, resamples: 2000 };

/** R's type-7 quantile of a sorted array. */
function quantile(sorted: readonly number[], p: number): number {
  const h = (sorted.length - 1) * p;
  const low = Math.floor(h);
  const high = Math.min(low + 1, sorted.length - 1);
  return sorted[low]! + (h - low) * (sorted[high]! - sorted[low]!);
}

/** The pre-declared agreement statistic: AC1 for binary labels, ordinal alpha for levels. */
function agreement(
  study: RatedStudy,
  x: readonly number[],
  y: readonly number[],
  items: readonly number[],
): number {
  if (study.scale === "levels") {
    return krippendorffAlpha(
      items.map((i) => [x[i]!, y[i]!]),
      "ordinal",
    );
  }
  const table = [
    [0, 0],
    [0, 0],
  ];
  for (const i of items) table[x[i]!]![y[i]!]! += 1;
  return gwetAc1(table);
}

/** Judge–rater agreement (the mean over the two raters) minus rater–rater agreement. */
function gap(study: RatedStudy, items: readonly number[]): number {
  const judgeRater =
    (agreement(study, study.judge, study.first, items) +
      agreement(study, study.judge, study.second, items)) /
    2;
  return judgeRater - agreement(study, study.first, study.second, items);
}

/**
 * The rule:
 * - agreement passes when the one-sided 95 % lower bound of the gap is at least −tolerance;
 * - the arm bias is b_c = (J₂ − J₁) − (H̄₂ − H̄₁) per case, on [0, 1], and its shown bound is
 *   max(|lower|, |upper|) of the two-sided 90 % percentile interval of its mean.
 * Both come from the same resamples of whole cases. A resample whose gap is NaN (an undefined
 * alpha) is counted in `nanReplicates` and left out of the quantile.
 */
export function calibrationRule(settings: RuleSettings = DEFAULT_SETTINGS): CalibrationRule {
  return (study, rng) => {
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

    const gaps: number[] = [];
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
      const g = gap(study, items);
      if (Number.isNaN(g)) nanReplicates += 1;
      else gaps.push(g);
    }
    const sortedGaps = gaps.toSorted((a, b) => a - b);
    const sortedBiases = biases.toSorted((a, b) => a - b);
    const lower = quantile(sortedBiases, 0.05);
    const upper = quantile(sortedBiases, 0.95);
    return {
      agreementPass: sortedGaps.length > 0 && quantile(sortedGaps, 0.05) >= -settings.tolerance,
      shownBound: Math.max(Math.abs(lower), Math.abs(upper)),
      armBias,
      nanReplicates,
      replicates: settings.resamples,
    };
  };
}
