import type { Rng } from "./rng.ts";
import { assertLevel } from "./types.ts";

/** One observation. Null is missing, not zero; its cluster remains in the resampling frame. */
export interface ClusterObservation {
  /** The cluster the row belongs to, such as its case or family. */
  readonly cluster: string;
  /** The row's outcome, or null when it is missing. */
  readonly value: number | null;
}

/**
 * A recorded resampling schedule. Each draw selects as many clusters as the input has, with
 * replacement. Indices are zero-based and refer to `clusterIds` in the schedule's own order, which
 * lists each input cluster exactly once. The seed is any safe integer, as R's set.seed accepts.
 */
export interface ClusterSchedule {
  /** Every input cluster exactly once, in the order the draw indices refer to. */
  readonly clusterIds: readonly string[];
  /** One row per resample: a zero-based index into `clusterIds` for each selected cluster. */
  readonly draws: readonly (readonly number[])[];
  /** The generator and sampling method that wrote the draws, such as R's RNGkind. */
  readonly algorithm: string;
  /** The seed that wrote the draws. */
  readonly seed: number;
}

/** Native random draws, or a replay of a recorded schedule from a registered analysis. */
export type ClusterBootstrapOptions = { readonly level?: number } & (
  | { readonly rng: Rng; readonly resamples: number; readonly schedule?: never }
  | { readonly schedule: ClusterSchedule; readonly rng?: never; readonly resamples?: never }
);

/**
 * A descriptive percentile interval for the mean of observed rows. Clusters are sampled equally;
 * all their observations travel together. Unequal clusters therefore keep their row weights.
 * This is estimate-only, never a validated decision method or evidence of non-inferiority.
 */
export interface ClusterBootstrapResult {
  /** The method's name. */
  readonly method: "cluster-percentile";
  /** Always true: the result is an estimate and carries no verdict. */
  readonly estimateOnly: true;
  /** Always false: no type-I or coverage study validates this method. */
  readonly validated: false;
  /** The mean of the observed values over all rows. */
  readonly estimate: number;
  /** The interval's lower bound, a type-7 quantile of the resampled means. */
  readonly lower: number;
  /** The interval's upper bound, a type-7 quantile of the resampled means. */
  readonly upper: number;
  /** The nominal two-sided level of the interval; its coverage is not established. */
  readonly level: number;
  /** The quantile definition, R's type 7. */
  readonly quantile: "R-type-7";
  /** The number of distinct clusters. */
  readonly clusters: number;
  /** The number of rows, missing ones included. */
  readonly observations: number;
  /** The number of rows with an observed value. */
  readonly available: number;
  /** The number of rows whose value is null. */
  readonly missing: number;
  /** The number of draws, including omitted ones. */
  readonly resamples: number;
  /** Draws containing no observed value are omitted, as in R's quantile(..., na.rm = TRUE). */
  readonly omittedResamples: number;
  /** Degenerate when every retained resampled mean is equal. */
  readonly intervalStatus: "regular" | "degenerate";
  /** How the draws were made: native seeded draws, or a replayed schedule. */
  readonly sampling: {
    readonly mode: "native" | "replay";
    readonly algorithm: string;
    readonly seed: number;
  };
  /** What the result does not support, for the reader of the estimate. */
  readonly limitations: readonly string[];
}

/** R's type-7 quantile, with linear interpolation at (n - 1) * p. */
function quantile(sorted: readonly number[], p: number): number {
  const position = (sorted.length - 1) * p;
  const lower = sorted[Math.floor(position)]!;
  const upper = sorted[Math.ceil(position)]!;
  return lower + (upper - lower) * (position - Math.floor(position));
}

function checkSchedule(schedule: ClusterSchedule, input: ReadonlySet<string>): void {
  const ids = schedule.clusterIds;
  if (new Set(ids).size !== ids.length)
    throw new RangeError("the replay schedule lists a cluster more than once");
  if (ids.length !== input.size || ids.some((id) => !input.has(id)))
    throw new RangeError("the replay schedule's clusters do not match the input's clusters");
  if (!schedule.algorithm.trim() || !Number.isSafeInteger(schedule.seed))
    throw new RangeError("a replay schedule needs its algorithm and a safe integer seed");
  for (const draw of schedule.draws) {
    if (
      draw.length !== ids.length ||
      draw.some((index) => !Number.isInteger(index) || index < 0 || index >= ids.length)
    )
      throw new RangeError("each replay draw must select one valid index per input cluster");
  }
}

/**
 * Resamples whole clusters and recomputes the row-weighted mean in every draw. Pairing is preserved
 * by supplying a paired difference per row, or by replaying the same schedule for each arm.
 * Missing values retain their clusters but contribute to neither the mean's numerator nor its
 * denominator. For a planned-attempt estimand, callers must instead supply its defined 0/1 outcome
 * for every planned attempt, including attempts with unavailable quality evidence.
 */
export function clusterBootstrap(
  input: readonly ClusterObservation[],
  options: ClusterBootstrapOptions,
): ClusterBootstrapResult {
  const level = options.level ?? 0.95;
  assertLevel(level);
  if (input.length === 0) throw new RangeError("cluster bootstrap needs at least one observation");
  const groups = new Map<string, { sum: number; count: number }>();
  let sum = 0;
  let available = 0;
  for (const row of input) {
    if (!row.cluster.trim()) throw new RangeError("cluster identifiers must not be empty");
    if (row.value !== null && !Number.isFinite(row.value))
      throw new RangeError("cluster values must be finite numbers or null");
    const group = groups.get(row.cluster) ?? { sum: 0, count: 0 };
    if (row.value !== null) {
      group.sum += row.value;
      group.count++;
      sum += row.value;
      available++;
    }
    groups.set(row.cluster, group);
  }
  if (available === 0) throw new RangeError("cluster bootstrap has no observed value");
  const schedule = options.schedule;
  if (schedule) checkSchedule(schedule, new Set(groups.keys()));
  // Native draws index the clusters in UTF-16 code-unit order; a replay keeps its schedule's order,
  // because R, for example, sorts by its locale's collation.
  const ids = schedule ? schedule.clusterIds : [...groups.keys()].toSorted();
  const clusters = ids.map((id) => groups.get(id)!);
  const resamples = schedule?.draws.length ?? options.resamples;
  if (resamples === undefined || !Number.isSafeInteger(resamples) || resamples < 1)
    throw new RangeError("cluster bootstrap resamples must be a positive safe integer");

  const estimates: number[] = [];
  for (let draw = 0; draw < resamples; draw++) {
    let total = 0;
    let count = 0;
    for (let position = 0; position < clusters.length; position++) {
      const selected = schedule
        ? schedule.draws[draw]![position]!
        : Math.floor(options.rng!.uniform() * clusters.length);
      if (!Number.isInteger(selected) || selected < 0 || selected >= clusters.length)
        throw new RangeError("the generator must return uniform numbers in [0, 1)");
      total += clusters[selected]!.sum;
      count += clusters[selected]!.count;
    }
    if (count > 0) estimates.push(total / count);
  }
  if (estimates.length === 0)
    throw new RangeError("every resample contains only missing values; no interval is available");
  if (!Number.isFinite(sum) || estimates.some((value) => !Number.isFinite(value)))
    throw new RangeError("cluster totals exceed the finite numeric range");
  estimates.sort((a, b) => a - b);
  const degenerate = estimates[0] === estimates[estimates.length - 1];
  const omittedResamples = resamples - estimates.length;
  const alpha = 1 - level;
  return {
    method: "cluster-percentile",
    estimateOnly: true,
    validated: false,
    estimate: sum / available,
    lower: quantile(estimates, alpha / 2),
    upper: quantile(estimates, 1 - alpha / 2),
    level,
    quantile: "R-type-7",
    clusters: clusters.length,
    observations: input.length,
    available,
    missing: input.length - available,
    resamples,
    omittedResamples,
    intervalStatus: degenerate ? "degenerate" : "regular",
    sampling: schedule
      ? { mode: "replay", algorithm: schedule.algorithm, seed: schedule.seed }
      : { mode: "native", algorithm: options.rng!.algorithm, seed: options.rng!.seed },
    limitations: [
      "descriptive percentile interval; not a validated decision method",
      "nominal coverage is not established at any cluster count",
      "cluster resampling does not establish random sampling or a population claim",
      ...(clusters.length < 40 ? ["fewer than 40 clusters: additional caution is needed"] : []),
      ...(degenerate
        ? ["degenerate resampling distribution; the point interval has no coverage claim"]
        : []),
      ...(omittedResamples > 0 ? ["resamples with only missing values were omitted"] : []),
    ],
  };
}
