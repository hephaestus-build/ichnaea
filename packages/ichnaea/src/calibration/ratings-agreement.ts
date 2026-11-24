import { krippendorffAlpha, type AlphaMetric } from "../stats/agreement.ts";
import { createRng } from "../stats/rng.ts";

import { CALIBRATION_DEFAULTS } from "./analyze.ts";
import { quantile, sorted } from "./statistics.ts";

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
type Scores = RatingSet["units"][number]["raters"];

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

function groupItems(units: RatingSet["units"]): Scores[][][] {
  const strata = new Map<string, Map<string, Scores[]>>();
  const itemStrata = new Map<string, string>();
  const slots = units[0]?.raters.length ?? 0;
  if (slots < 2) throw new RangeError("agreement needs a unit with at least two rater columns");
  for (const { item, stratum, raters } of units) {
    if (raters.length !== slots) throw new RangeError("all units need the same rater columns");
    const previous = itemStrata.get(item);
    if (previous !== undefined && previous !== stratum)
      throw new RangeError("an item cannot belong to more than one stratum");
    itemStrata.set(item, stratum);
    const items = strata.get(stratum) ?? new Map<string, Scores[]>();
    const rows = items.get(item) ?? [];
    rows.push(raters);
    items.set(item, rows);
    strata.set(stratum, items);
  }
  return [...strata.values()].map((items) => [...items.values()]);
}

/** Resample whole items within each stratum, then recompute alpha in every draw. */
export function summarizeRatings(input: RatingSet, seed: number): RatingAgreement {
  const { metric, units } = input;
  const strata = groupItems(units);
  const scores = units.map(({ raters }) => raters);
  const observed = scores.map((raters) => raters.filter((rating) => rating !== null).length);
  const paired = observed.filter((count) => count >= 2);
  const pairedItems = new Set(
    units.filter((_, index) => observed[index]! >= 2).map(({ item }) => item),
  ).size;
  const estimate = krippendorffAlpha(scores, metric);
  const rng = createRng(seed);
  const itemCount = strata.reduce((count, items) => count + items.length, 0);
  let unavailableReason: string | null = null;
  if (!Number.isFinite(estimate)) unavailableReason = "alpha is undefined";
  else if (pairedItems < 2) unavailableReason = "fewer than two items have paired ratings";
  else if (!strata.some((items) => items.length > 1))
    unavailableReason = "every stratum has only one item";
  const resamples = unavailableReason === null ? CALIBRATION_DEFAULTS.resamples : 0;
  const estimates = sorted(
    Array.from({ length: resamples }, () => {
      const sample = strata.flatMap((items) =>
        items.flatMap(() => items[Math.floor(rng.uniform() * items.length)]!),
      );
      return krippendorffAlpha(sample, metric);
    }),
  );
  if (unavailableReason === null && estimates.length === 0)
    unavailableReason = "no resample gave a finite alpha";
  else if (unavailableReason === null && estimates[0] === estimates.at(-1))
    unavailableReason = "the finite resamples all give the same alpha";
  return {
    statistic: "krippendorff-alpha",
    metric,
    estimate: Number.isFinite(estimate) ? estimate : null,
    counts: {
      items: itemCount,
      units: units.length,
      pairedUnits: paired.length,
      pairedItems,
      raters: scores[0]!.length,
      ratings: observed.reduce((sum, count) => sum + count, 0),
      pairedRatings: paired.reduce((sum, count) => sum + count, 0),
    },
    interval: {
      method: "item-cluster-percentile",
      level: 0.95,
      validated: false,
      seed: rng.seed,
      algorithm: rng.algorithm,
      lower: unavailableReason === null ? quantile(estimates, 0.025) : null,
      upper: unavailableReason === null ? quantile(estimates, 0.975) : null,
      resamples,
      omittedResamples: resamples - estimates.length,
      unavailableReason,
    },
  };
}
