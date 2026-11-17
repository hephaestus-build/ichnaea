import { pnorm, qnorm } from "./normal.ts";
import type { Rng } from "./rng.ts";
import { assertLevel, type Interval, type Sided, type Weighting } from "./types.ts";

/** One top cluster: the means of its cases (each case's replicates already averaged). */
export interface BcaCluster {
  /** The cluster's ID, a family or a case. Draws index the clusters in code-unit order of ID. */
  readonly id: string;
  /** The mean of each of the cluster's cases, in [0, 1]. */
  readonly caseMeans: readonly number[];
}

/** Why BCa gives no interval. */
export type BcaRefusal = "BCA_UNDEFINED" | "ZERO_WIDTH";

/** A BCa result: the interval, or why there is none. */
export type BcaResult =
  | {
      /** The interval. */
      readonly interval: Interval;
      /** The bias correction z₀. */
      readonly z0: number;
      /** The jackknife acceleration a. */
      readonly acceleration: number;
      readonly refusal?: never;
    }
  | {
      readonly interval?: never;
      readonly z0?: never;
      readonly acceleration?: never;
      /** Why there is no interval. */
      readonly refusal: BcaRefusal;
      /** The point estimate. */
      readonly estimate: number;
    };

interface Totals {
  sum: number;
  cases: number;
  clusterMeans: number;
  clusters: number;
}

const statistic = (t: Totals, weighting: Weighting): number =>
  weighting === "per-case" ? t.sum / t.cases : t.clusterMeans / t.clusters;

/** R's type-7 quantile of sorted values. */
function quantile(sorted: readonly number[], p: number): number {
  const position = (sorted.length - 1) * p;
  const below = sorted[Math.floor(position)]!;
  const above = sorted[Math.ceil(position)]!;
  return below + (above - below) * (position - Math.floor(position));
}

/**
 * The bias-corrected and accelerated (BCa) bootstrap interval, resampling the top clusters only.
 * The replicates of a case are never resampled. BCa respects transformations and stays inside
 * [0, 1]. z₀ = Φ⁻¹((#{θ* < θ̂ − tol} + ½·#{|θ* − θ̂| ≤ tol})/B), with tol a relative 1e-12: a
 * resampled estimate within rounding of the estimate counts half, so the many exact ties on a
 * lattice of case means neither push z₀ down nor depend on the order of summation. The
 * acceleration is the jackknife over clusters, a = Σd³ / (6·(Σd²)^{3/2}). The bounds are type-7
 * quantiles of the resampled estimates at the adjusted levels Φ(z₀ + (z₀ + z)/(1 − a(z₀ + z))).
 * They stay inside the range of the resampled estimates, so inside [0, 1]. Its coverage is not
 * validated.
 */
export function bcaInterval(
  input: readonly BcaCluster[],
  weighting: Weighting,
  rng: Rng,
  resamples: number,
  level = 0.95,
  sided: Sided = "two",
): BcaResult {
  assertLevel(level);
  if (!(Number.isSafeInteger(resamples) && resamples >= 1))
    throw new RangeError("bcaInterval: resamples must be a positive safe integer");
  if (input.length < 2) throw new RangeError("bcaInterval needs at least two clusters");
  if (new Set(input.map((c) => c.id)).size !== input.length)
    throw new RangeError("bcaInterval: cluster IDs must be unique");
  const clusters = input
    .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((c) => {
      if (c.caseMeans.length === 0) throw new RangeError(`cluster '${c.id}' has no case`);
      for (const m of c.caseMeans)
        if (!(Number.isFinite(m) && m >= 0 && m <= 1))
          throw new RangeError(`cluster '${c.id}': case mean ${m} is not in [0, 1]`);
      const sum = c.caseMeans.reduce((a, b) => a + b, 0);
      return { sum, cases: c.caseMeans.length, mean: sum / c.caseMeans.length };
    });
  const totals = (pick: (add: (index: number) => void) => void): Totals => {
    const t = { sum: 0, cases: 0, clusterMeans: 0, clusters: 0 };
    pick((index) => {
      const c = clusters[index]!;
      t.sum += c.sum;
      t.cases += c.cases;
      t.clusterMeans += c.mean;
      t.clusters++;
    });
    return t;
  };
  const g = clusters.length;
  const estimate = statistic(
    totals((add) => clusters.forEach((_, i) => add(i))),
    weighting,
  );

  const draws: number[] = [];
  for (let b = 0; b < resamples; b++)
    draws.push(
      statistic(
        totals((add) => {
          for (let j = 0; j < g; j++) {
            const index = Math.floor(rng.uniform() * g);
            if (!(index >= 0 && index < g))
              throw new RangeError("the generator must return uniform numbers in [0, 1)");
            add(index);
          }
        }),
        weighting,
      ),
    );
  draws.sort((a, b) => a - b);
  const tolerance = 1e-12 * Math.max(1, Math.abs(estimate));
  const below = draws.filter((d) => d < estimate - tolerance).length;
  const ties = draws.filter((d) => Math.abs(d - estimate) <= tolerance).length;
  const share = (below + 0.5 * ties) / resamples;
  if (share === 0 || share === 1) return { refusal: "BCA_UNDEFINED", estimate };
  const z0 = qnorm(share);

  const jackknife = clusters.map((_, left) =>
    statistic(
      totals((add) => clusters.forEach((__, i) => i !== left && add(i))),
      weighting,
    ),
  );
  const centre = jackknife.reduce((a, b) => a + b, 0) / g;
  let cubes = 0;
  let squares = 0;
  for (const value of jackknife) {
    const d = centre - value;
    cubes += d ** 3;
    squares += d ** 2;
  }
  const a = squares === 0 ? 0 : cubes / (6 * squares ** 1.5);

  const tail = sided === "two" ? (1 - level) / 2 : 1 - level;
  const adjusted = (z: number): number | null => {
    const denominator = 1 - a * (z0 + z);
    return denominator > 0 ? pnorm(z0 + (z0 + z) / denominator) : null;
  };
  const lowLevel = sided === "upper" ? 0 : adjusted(qnorm(tail));
  const highLevel = sided === "lower" ? 1 : adjusted(qnorm(1 - tail));
  if (lowLevel === null || highLevel === null) return { refusal: "BCA_UNDEFINED", estimate };
  const lower = sided === "upper" ? 0 : quantile(draws, lowLevel);
  const upper = sided === "lower" ? 1 : quantile(draws, highLevel);
  if (lower === upper) return { refusal: "ZERO_WIDTH", estimate };
  return { interval: { estimate, lower, upper, level, sided, method: "bca" }, z0, acceleration: a };
}
