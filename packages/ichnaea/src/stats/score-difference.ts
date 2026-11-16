import { critical, pnorm } from "./normal.ts";
import { lowerRoot, upperRoot } from "./solve.ts";
import {
  assertCount,
  assertLevel,
  type Count,
  type Interval,
  type Sided,
  type TestResult,
} from "./types.ts";

/** One stratum: the candidate's and the base's count. In `fixed-cases`, one stratum per case. */
export interface Stratum {
  readonly candidate: Count;
  readonly base: Count;
}

/**
 * Options of the stratified score method for a difference of proportions. The defaults are the
 * Miettinen–Nurminen method: bias correction on, skewness correction off. A simulation study
 * (scripts/stats/study-fixed-cases.ts, 252 grid points, 10,000 repetitions) chose them: at 2 replicates
 * per case the variants without the N/(N-1) factor undercover (minimum 0.88 to 0.92), and the
 * skewness correction does not help once the factor is applied.
 */
export interface ScoreOptions {
  /** Miettinen–Nurminen's N/(N-1) variance factor per stratum. Default true. */
  readonly biasCorrection?: boolean;
  /** Gart–Nam skewness correction (Laud 2017). Default false. */
  readonly skewnessCorrection?: boolean;
  /**
   * Stratum weights. `equal` (the default) weights every case alike, so the estimate is the mean
   * of the per-case differences: the fixed-cases estimand, whatever the replicate counts.
   * `mantel-haenszel` weights by n1·n2/(n1+n2), which equals `equal` when every case has the same
   * counts.
   */
  readonly weights?: "equal" | "mantel-haenszel";
}

interface Restricted {
  readonly p1: number;
  readonly p2: number;
}

const EDGE = 1e-12;

/**
 * Maximum-likelihood estimates of both proportions under the constraint p1 - p2 = delta
 * (Farrington and Manning 1990, closed form of Miettinen and Nurminen 1985).
 */
export function restrictedMle(
  x1: number,
  n1: number,
  x2: number,
  n2: number,
  delta: number,
): Restricted {
  const p1h = x1 / n1;
  const p2h = x2 / n2;
  const theta = n2 / n1;
  const a = 1 + theta;
  const b = -(1 + theta + p1h + theta * p2h + delta * (theta + 2));
  const c = delta * delta + delta * (2 * p1h + theta + 1) + p1h + theta * p2h;
  const d = -p1h * delta * (1 + delta);
  const v = b ** 3 / (27 * a ** 3) - (b * c) / (6 * a * a) + d / (2 * a);
  const inner = (b * b) / (9 * a * a) - c / (3 * a);
  const u = (v >= 0 ? 1 : -1) * Math.sqrt(Math.max(inner, 0));
  let p1: number;
  if (u === 0) {
    p1 = -b / (3 * a);
  } else {
    const ratio = Math.min(1, Math.max(-1, v / u ** 3));
    const w = (Math.PI + Math.acos(ratio)) / 3;
    p1 = 2 * u * Math.cos(w) - b / (3 * a);
  }
  p1 = Math.min(1, Math.max(0, p1));
  const p2 = Math.min(1, Math.max(0, p1 - delta));
  return { p1, p2 };
}

interface Prepared {
  readonly strata: ReadonlyArray<{ x1: number; n1: number; x2: number; n2: number; w: number }>;
  readonly estimate: number;
}

function prepare(
  strata: readonly Stratum[],
  weights: "equal" | "mantel-haenszel" = "equal",
): Prepared {
  const usable = strata
    .map((s, i) => {
      assertCount(s.candidate, `stratum ${i} candidate`);
      assertCount(s.base, `stratum ${i} base`);
      return {
        x1: s.candidate.successes,
        n1: s.candidate.trials,
        x2: s.base.successes,
        n2: s.base.trials,
      };
    })
    // A stratum with one arm missing carries no paired information (it is reported, not used).
    .filter((s) => s.n1 > 0 && s.n2 > 0);
  const raw = usable.map((s) => (weights === "equal" ? 1 : (s.n1 * s.n2) / (s.n1 + s.n2)));
  const total = raw.reduce((acc, w) => acc + w, 0);
  const withWeights = usable.map((s, i) => ({ ...s, w: (raw[i] as number) / total }));
  const estimate = withWeights.reduce((acc, s) => acc + s.w * (s.x1 / s.n1 - s.x2 / s.n2), 0);
  return { strata: withWeights, estimate };
}

function scoreFunction(prepared: Prepared, options: ScoreOptions): (delta: number) => number {
  const bias = options.biasCorrection ?? true;
  const skew = options.skewnessCorrection ?? false;
  // Cases share few distinct tables (with 2 trials per arm, at most 9), so each evaluation solves
  // the restricted MLE once per distinct table. The sums still run over the strata in their order,
  // with the same operations, so the result is bit-identical to solving every stratum.
  const tables: Array<{ x1: number; n1: number; x2: number; n2: number }> = [];
  const index = new Map<string, number>();
  const terms = prepared.strata.map((s) => {
    const key = `${s.x1}/${s.n1}/${s.x2}/${s.n2}`;
    let table = index.get(key);
    if (table === undefined) {
      table = tables.length;
      index.set(key, table);
      tables.push({ x1: s.x1, n1: s.n1, x2: s.x2, n2: s.n2 });
    }
    const factor = bias ? (s.n1 + s.n2) / (s.n1 + s.n2 - 1) : 1;
    return { table, varianceWeight: s.w * s.w * factor, skewWeight: s.w ** 3 };
  });
  const varianceTerm = new Float64Array(tables.length);
  const skewTerm = new Float64Array(tables.length);
  return (deltaIn: number): number => {
    const delta = Math.min(1 - EDGE, Math.max(-1 + EDGE, deltaIn));
    for (let i = 0; i < tables.length; i++) {
      const t = tables[i]!;
      const { p1, p2 } = restrictedMle(t.x1, t.n1, t.x2, t.n2, delta);
      varianceTerm[i] = (p1 * (1 - p1)) / t.n1 + (p2 * (1 - p2)) / t.n2;
      skewTerm[i] =
        (p1 * (1 - p1) * (1 - 2 * p1)) / t.n1 ** 2 - (p2 * (1 - p2) * (1 - 2 * p2)) / t.n2 ** 2;
    }
    let variance = 0;
    let mu3 = 0;
    for (const s of terms) {
      variance += s.varianceWeight * varianceTerm[s.table]!;
      mu3 += s.skewWeight * skewTerm[s.table]!;
    }
    const numerator = prepared.estimate - delta;
    if (variance <= 0) return numerator > 0 ? Infinity : numerator < 0 ? -Infinity : 0;
    const score = numerator / Math.sqrt(variance);
    return skew ? skewCorrected(score, mu3 / (6 * variance ** 1.5)) : score;
  };
}

/**
 * Gart–Nam skewness correction (Laud 2017): the corrected score S solves
 * score = S + c (S^2 - 1), with c = mu3 / (6 V^(3/2)). The root that tends to `score` as c -> 0.
 */
export function skewCorrected(score: number, c: number): number {
  if (c === 0 || !Number.isFinite(score)) return score;
  const discriminant = 1 + 4 * c * (score + c);
  // No real root: fall back to the uncorrected score, as ratesci does.
  if (discriminant < 0) return score;
  // The rationalised root avoids cancellation when c is tiny: (-1 + √D) / (2c) = 2(s + c) / (1 + √D).
  return (2 * (score + c)) / (1 + Math.sqrt(discriminant));
}

function methodName(options: ScoreOptions, stratified: boolean): string {
  const skew = options.skewnessCorrection ?? false;
  const bias = options.biasCorrection ?? true;
  const weights = stratified && options.weights === "mantel-haenszel" ? "-mh" : "";
  return `${stratified ? "stratified-" : ""}score-rd${skew ? "-skew" : ""}${bias ? "-bc" : ""}${weights}`;
}

/**
 * Score interval for a difference of proportions, candidate minus base, stratified over cases
 * (Miettinen–Nurminen with Mantel–Haenszel weights).
 * A case without variance still contributes, because its variance is evaluated under each
 * hypothesised difference, so the interval does not collapse on stable cases.
 */
export function scoreDifferenceInterval(
  strata: readonly Stratum[],
  level = 0.95,
  sided: Sided = "two",
  options: ScoreOptions = {},
): Interval {
  assertLevel(level);
  const prepared = prepare(strata, options.weights);
  const method = methodName(options, strata.length > 1);
  if (prepared.strata.length === 0)
    return { estimate: Number.NaN, lower: -1, upper: 1, level, sided, method };
  const f = scoreFunction(prepared, options);
  const z = critical(level, sided);
  const lower = sided === "upper" ? -1 : lowerRoot(f, z, -1, 1);
  const upper = sided === "lower" ? 1 : upperRoot(f, -z, -1, 1);
  return { estimate: prepared.estimate, lower, upper, level, sided, method };
}

/**
 * One-sided score test of H0: difference <= delta0 against H1: difference > delta0
 * (`greater`), or H0: difference >= delta0 against H1: difference < delta0 (`less`).
 */
export function scoreDifferenceTest(
  strata: readonly Stratum[],
  delta0: number,
  alternative: "greater" | "less",
  options: ScoreOptions = {},
): TestResult {
  const prepared = prepare(strata, options.weights);
  const method = methodName(options, strata.length > 1);
  if (prepared.strata.length === 0) return { statistic: 0, p: 1, method };
  const statistic = scoreFunction(prepared, options)(delta0);
  const p = alternative === "greater" ? pnorm(-statistic) : pnorm(statistic);
  return { statistic, p, method };
}
