import { bcaInterval, type BcaCluster } from "./bca.ts";
import { clopperPearson } from "./clopper-pearson.ts";
import { hoeffding } from "./hoeffding.ts";
import { oneArmScoreInterval } from "./one-arm-score.ts";
import type { Rng } from "./rng.ts";
import { assertLevel, type Interval, type Sided, type Weighting } from "./types.ts";
import { wilsonMean } from "./wilson.ts";
import { weightedMean } from "./weighted-mean.ts";

/** What an estimate is about: the cases that ran, or a population they were drawn from. */
export type EstimateEstimand = "these-cases" | "population";

/** One case of one arm. */
export interface EstimateCase {
  /** The case's ID, unique in the estimate. */
  readonly id: string;
  /** The case's family; a case without one is a family of its own. */
  readonly family?: string;
  /** The values of the completed trials: 0 or 1 for binary measures, in [0, 1] for scores. */
  readonly values: readonly number[];
  /** The trials the plan asked for, at least the completed ones; by default the completed ones. */
  readonly planned?: number;
}

/** A one-arm estimate. */
export interface EstimateInput {
  /** The value type. A level with equal spacing or a proportion is passed as a score. */
  readonly valueType: "binary" | "score";
  /** By default `these-cases`. */
  readonly estimand?: EstimateEstimand;
  /** By default `per-case`. */
  readonly weighting?: Weighting;
  /** Every planned case of the arm, with or without values. */
  readonly cases: readonly EstimateCase[];
  /** By default 0.95. */
  readonly level?: number;
  /** By default two-sided. */
  readonly sided?: Sided;
  /**
   * For `population` only. `frame` states that the cases were drawn from a declared sampling frame
   * that the caller checks. The generator draws the clusters, and its seed is recorded.
   */
  readonly population?: { readonly frame: boolean; readonly rng: Rng; readonly resamples: number };
}

/**
 * What the interval's coverage rests on. `conservative`: a theorem bounds it at every true rate.
 * `not-validated`: no study has shown it, so the card says "coverage not validated".
 */
export type Coverage = "conservative" | "not-validated";

/** An interval with what its coverage rests on. */
export interface EstimateInterval extends Interval {
  /** What the interval's coverage rests on. */
  readonly coverage: Coverage;
}

/** Why an estimate has no interval. */
export type NoInterval =
  | "NO_VALUES"
  | "NO_SAMPLING_FRAME"
  | "FEWER_THAN_30_CLUSTERS"
  | "BCA_UNDEFINED"
  | "ZERO_WIDTH";

/** A one-arm estimate with its interval, its worst-case bounds and its operational estimand. */
export interface EstimateResult {
  /** The input's value type. */
  readonly valueType: "binary" | "score";
  /** The estimand the interval answers. */
  readonly estimand: EstimateEstimand;
  /** How the cases weigh in the mean. */
  readonly weighting: Weighting;
  /** The weighted mean of the case means over the cases with a value; NaN when there is none. */
  readonly estimate: number;
  /** Null when there is no interval, with the reason in `noInterval`. Never zero-width. */
  readonly interval: EstimateInterval | null;
  /** Why there is no interval, when `interval` is null. */
  readonly noInterval?: NoInterval;
  /** The number of cases with at least one value. */
  readonly cases: number;
  /** The number of planned cases with no value. */
  readonly missingCases: number;
  /**
   * The estimate over every planned trial, with each missing trial a failure (`low`) or a pass
   * (`high`), under the same weighting.
   */
  readonly worstCase: {
    /** Every missing trial a failure. */
    readonly low: number;
    /** Every missing trial a pass. */
    readonly high: number;
  };
  /**
   * The operational estimand: missing as failure, over planned trials, with its own interval
   * Its estimate is `worstCase.low`. It never enters a compare decision.
   */
  readonly operational: EstimateInterval;
  /** For `population`: how the clusters were drawn. */
  readonly resampling?: {
    /** The generator's algorithm. */
    readonly algorithm: string;
    /** The generator's seed. */
    readonly seed: number;
    /** The number of resamples. */
    readonly resamples: number;
    /** The number of top clusters. */
    readonly clusters: number;
  };
}

/** The fewest top clusters a `population` interval needs. */
export const POPULATION_MIN_CLUSTERS = 30;

interface Prepared {
  readonly id: string;
  readonly family: string;
  readonly sum: number;
  readonly trials: number;
  readonly planned: number;
  readonly values: readonly number[];
}

function prepare(input: EstimateInput): Prepared[] {
  const ids = new Set<string>();
  return input.cases.map((c) => {
    if (ids.has(c.id)) throw new RangeError(`case '${c.id}' appears more than once`);
    ids.add(c.id);
    for (const v of c.values) {
      const ok =
        input.valueType === "binary" ? v === 0 || v === 1 : Number.isFinite(v) && v >= 0 && v <= 1;
      if (!ok) throw new RangeError(`case '${c.id}': ${v} is not a ${input.valueType} value`);
    }
    const planned = c.planned ?? c.values.length;
    if (!(Number.isInteger(planned) && planned >= c.values.length))
      throw new RangeError(`case '${c.id}': ${planned} planned trials, ${c.values.length} values`);
    return {
      id: c.id,
      family: c.family ?? `\u0000${c.id}`,
      sum: c.values.reduce((a, b) => a + b, 0),
      trials: c.values.length,
      planned,
      values: c.values,
    };
  });
}

/** Each case's weight: 1/k per case, or 1/(F·n_f) per family. */
function weightsOf(cases: readonly Prepared[], weighting: Weighting): number[] {
  if (weighting === "per-case") return cases.map(() => 1 / cases.length);
  const sizes = new Map<string, number>();
  for (const c of cases) sizes.set(c.family, (sizes.get(c.family) ?? 0) + 1);
  return cases.map((c) => 1 / (sizes.size * sizes.get(c.family)!));
}

const allEqual = (values: readonly number[]): boolean =>
  values.every((v) => Math.abs(v - values[0]!) <= 1e-12 * values[0]!);

const withCoverage = (interval: Interval, coverage: Coverage): EstimateInterval => ({
  ...interval,
  coverage,
});

/**
 * The interval of the operational estimand: binary trials of equal weight give Clopper–Pearson
 * on the pooled count over planned trials; any other case gives Hoeffding's bound over the trials.
 */
function operationalOf(
  input: EstimateInput,
  planned: readonly Prepared[],
  weights: readonly number[],
  level: number,
  sided: Sided,
): EstimateInterval {
  const trialWeights = planned.map((c, i) => weights[i]! / c.planned);
  if (input.valueType === "binary" && allEqual(trialWeights)) {
    const successes = planned.reduce((a, c) => a + c.sum, 0);
    const trials = planned.reduce((a, c) => a + c.planned, 0);
    return withCoverage(clopperPearson({ successes, trials }, level, sided), "conservative");
  }
  // Each planned trial is one term; a missing trial is a 0.
  const values: number[] = [];
  const termWeights: number[] = [];
  planned.forEach((c, i) => {
    for (let t = 0; t < c.planned; t++) {
      values.push(c.values[t] ?? 0);
      termWeights.push(trialWeights[i]!);
    }
  });
  return withCoverage(hoeffding(values, termWeights, level, sided), "conservative");
}

/**
 * A one-arm estimate, by these rules.
 *
 * `these-cases`, from within-case variance only:
 * - one trial per case, binary, equal weights: Clopper–Pearson on the pooled count, conservative;
 * - one trial per case, scores, equal weights: Wilson on the pooled mean, not validated;
 * - one trial per case, unequal weights (per family, families of different sizes): Hoeffding's
 *   bound, conservative;
 * - otherwise: the one-arm stratified score interval, not validated.
 *
 * `population`: BCa over the top clusters (families, else cases), with at least 30 clusters and a
 * declared frame, not validated.
 */
export function estimate(input: EstimateInput): EstimateResult {
  const level = input.level ?? 0.95;
  const sided = input.sided ?? "two";
  const estimand = input.estimand ?? "these-cases";
  const weighting = input.weighting ?? "per-case";
  assertLevel(level);
  if (estimand === "population" && !input.population)
    throw new RangeError("a population estimate needs its frame statement and generator");

  const all = prepare(input);
  const planned = all.filter((c) => c.planned > 0);
  if (planned.length === 0) throw new RangeError("an estimate needs at least one planned trial");
  const plannedWeights = weightsOf(planned, weighting);
  const worstCase = {
    low: weightedMean(
      planned.map((c) => c.sum / c.planned),
      plannedWeights,
    ),
    high: weightedMean(
      planned.map((c) => (c.sum + c.planned - c.trials) / c.planned),
      plannedWeights,
    ),
  };
  const operational = operationalOf(input, planned, plannedWeights, level, sided);
  const observed = all.filter((c) => c.trials > 0);
  const weights = weightsOf(observed, weighting);
  const point = weightedMean(
    observed.map((c) => c.sum / c.trials),
    weights,
  );
  const base = {
    valueType: input.valueType,
    estimand,
    weighting,
    cases: observed.length,
    missingCases: planned.length - observed.length,
    worstCase,
    operational,
  };
  const none = (reason: NoInterval, estimateValue: number): EstimateResult => ({
    ...base,
    estimate: estimateValue,
    interval: null,
    noInterval: reason,
  });
  if (observed.length === 0) return none("NO_VALUES", Number.NaN);

  if (estimand === "population") {
    const { frame, rng, resamples } = input.population!;
    if (!frame) return none("NO_SAMPLING_FRAME", point);
    const groups = new Map<string, number[]>();
    for (const c of observed)
      groups.set(c.family, [...(groups.get(c.family) ?? []), c.sum / c.trials]);
    if (groups.size < POPULATION_MIN_CLUSTERS) return none("FEWER_THAN_30_CLUSTERS", point);
    const clusters: BcaCluster[] = [...groups].map(([id, caseMeans]) => ({ id, caseMeans }));
    const result = bcaInterval(clusters, weighting, rng, resamples, level, sided);
    const resampling = {
      algorithm: rng.algorithm,
      seed: rng.seed,
      resamples,
      clusters: clusters.length,
    };
    if (result.refusal !== undefined) return { ...none(result.refusal, point), resampling };
    return {
      ...base,
      estimate: point,
      interval: withCoverage(result.interval, "not-validated"),
      resampling,
    };
  }

  let interval: EstimateInterval;
  if (observed.every((c) => c.trials === 1)) {
    if (!allEqual(weights)) {
      const values = observed.map((c) => c.sum);
      interval = withCoverage(hoeffding(values, weights, level, sided), "conservative");
    } else if (input.valueType === "binary") {
      const successes = observed.reduce((a, c) => a + c.sum, 0);
      interval = withCoverage(
        clopperPearson({ successes, trials: observed.length }, level, sided),
        "conservative",
      );
    } else {
      interval = withCoverage(wilsonMean(point, observed.length, level, sided), "not-validated");
    }
  } else {
    const cells = observed.map((c, i) => ({ sum: c.sum, trials: c.trials, weight: weights[i]! }));
    interval = withCoverage(oneArmScoreInterval(cells, level, sided), "not-validated");
  }
  if (interval.lower === interval.upper) return none("ZERO_WIDTH", point);
  return { ...base, estimate: point, interval };
}
