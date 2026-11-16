import { createRng, type Rng } from "./rng.ts";

/**
 * One case's completed trial values under both arms, each a score in [0, 1]. A proportion arrives
 * already reduced to one value per trial: its items are never trials (decision 0008).
 */
export interface CaseScores {
  readonly id: string;
  readonly family?: string;
  readonly base: readonly number[];
  readonly candidate: readonly number[];
}

/** The result of the within-case permutation test on scores. */
export interface ScorePermutationResult {
  /** The equal-weight mean of per-case differences in means, candidate minus base. */
  readonly statistic: number;
  /**
   * One-sided p-value toward a drop. Exact: the share of within-case arm labellings with T at most
   * T observed. Monte Carlo: (1 + count) / (1 + resamples).
   */
  readonly p: number;
  readonly method: "within-case-permutation-exact" | "within-case-permutation-monte-carlo";
  /** Monte Carlo only: the resamples behind `p`. */
  readonly resamples?: number;
  /** Monte Carlo only: the standard error of `p`. */
  readonly monteCarloSE?: number;
  /** Monte Carlo only: the seed of the generator behind `p`. */
  readonly seed?: number;
}

/** Options of the score permutation test. */
export interface ScorePermutationOptions {
  /** Seeded generator for the Monte Carlo path. Required when the exact path is not cheap. */
  readonly rng?: Rng;
  /** Monte Carlo resamples. */
  readonly resamples?: number;
  /**
   * The levels the p-value will be compared with: alpha, or each level Holm may compare it with.
   * A Monte Carlo p within 3 standard errors of one of them is computed again with
   * SCORE_PERMUTATION_RESAMPLES_NEAR_LEVEL resamples and a new seed, and that result is reported.
   */
  readonly levels?: readonly number[];
}

/** Monte Carlo resamples of the score permutation test when it cannot enumerate. */
export const SCORE_PERMUTATION_RESAMPLES = 10_000;
/** Monte Carlo resamples when the p-value lies within 3 standard errors of a level. */
export const SCORE_PERMUTATION_RESAMPLES_NEAR_LEVEL = 100_000;

/** Largest lattice denominator the exact path looks for: every value must be a multiple of 1/D. */
const MAX_DENOMINATOR = 1000;
/** Largest number of label assignments of one case on the exact path. */
const MAX_ASSIGNMENTS = 100_000;
/** Largest support of the null distribution times the number of cases on the exact path. */
const MAX_SUPPORT_TIMES_CASES = 50_000_000;
const LATTICE_TOLERANCE = 1e-9;
/** Floating tolerance of the Monte Carlo comparison: ties count as at most T observed. */
const MONTE_CARLO_TOLERANCE = 1e-9;
/** Added to the seed of a Monte Carlo test that is computed again near a level. */
const NEAR_LEVEL_SEED_OFFSET = 1_000_003;

const gcd = (a: number, b: number): number => {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x;
};
const lcm = (a: number, b: number): number => (a / gcd(a, b)) * b;
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

function choose(n: number, k: number): number {
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return Math.round(c);
}

/** The smallest D up to MAX_DENOMINATOR such that every value times D is an integer, if any. */
function latticeDenominator(values: readonly number[]): number | undefined {
  const distinct = [...new Set(values)];
  for (let d = 1; d <= MAX_DENOMINATOR; d++) {
    if (distinct.every((v) => Math.abs(v * d - Math.round(v * d)) <= LATTICE_TOLERANCE)) return d;
  }
  return undefined;
}

/**
 * The number of ways to pick `picks` of the non-negative integers `values`, for each sum from the
 * smallest possible sum to the largest: a dynamic programme over the values.
 */
function subsetSums(values: readonly number[], picks: number): Float64Array {
  const sorted = values.toSorted((a, b) => a - b);
  const min = sum(sorted.slice(0, picks));
  const max = sum(sorted.slice(sorted.length - picks));
  // ways[c][s]: the ways to pick c values with sum s.
  const ways = Array.from({ length: picks + 1 }, () => new Float64Array(max + 1));
  (ways[0] as Float64Array)[0] = 1;
  for (const v of sorted) {
    for (let c = picks - 1; c >= 0; c--) {
      const from = ways[c] as Float64Array;
      const to = ways[c + 1] as Float64Array;
      for (let s = max - v; s >= 0; s--) {
        const n = from[s] as number;
        if (n !== 0) to[s + v] = (to[s + v] as number) + n;
      }
    }
  }
  return (ways[picks] as Float64Array).slice(min);
}

interface UsedCase {
  readonly base: readonly number[];
  readonly candidate: readonly number[];
}

/** The per-case weight of the candidate sum in T, up to the factor 1/k: (nC + nB) / (nC · nB). */
const weightOf = (c: UsedCase): number =>
  (c.candidate.length + c.base.length) / (c.candidate.length * c.base.length);

/**
 * The exact p-value by convolution on the values' lattice, or undefined when that is not cheap.
 * Up to a constant and the factor 1/k, T is the sum over cases of w·(candidate sum), and the
 * candidate sums of different cases are independent under the permutation. With every value a
 * multiple of 1/D and M the least common multiple of the products nC·nB, each M·w·D·(candidate sum)
 * is an integer, so the null distribution of T is a convolution of integer distributions.
 */
function exactP(cases: readonly UsedCase[]): number | undefined {
  const d = latticeDenominator(cases.flatMap((c) => [...c.base, ...c.candidate]));
  if (d === undefined) return undefined;
  const sizes = cases.map((c) => choose(c.base.length + c.candidate.length, c.candidate.length));
  if (sizes.some((n) => n > MAX_ASSIGNMENTS)) return undefined;
  const m = cases.reduce((acc, c) => lcm(acc, c.candidate.length * c.base.length), 1);
  const raw = cases.map((c) => Math.round(m * weightOf(c)));
  const common = raw.reduce((acc, w) => gcd(acc, w), 0);
  const weights = raw.map((w) => w / common);
  const units = cases.map((c) => ({
    candidate: c.candidate.map((v) => Math.round(v * d)),
    pooled: [...c.candidate, ...c.base].map((v) => Math.round(v * d)),
  }));
  const spans = units.map((u, i) => {
    const sorted = u.pooled.toSorted((a, b) => a - b);
    const n = u.candidate.length;
    return (
      (weights[i] as number) * (sum(sorted.slice(sorted.length - n)) - sum(sorted.slice(0, n)))
    );
  });
  if ((sum(spans) + 1) * cases.length > MAX_SUPPORT_TIMES_CASES) return undefined;

  // The observed statistic and the distribution, both shifted so that the smallest sum is 0.
  let observed = 0;
  let distribution = Float64Array.of(1);
  for (const [i, u] of units.entries()) {
    const w = weights[i] as number;
    const ways = subsetSums(u.pooled, u.candidate.length);
    const lowest = sum(u.pooled.toSorted((a, b) => a - b).slice(0, u.candidate.length));
    observed += w * (sum(u.candidate) - lowest);
    if (ways.length === 1) continue; // Every labelling gives this case the same contribution.
    const total = sizes[i] as number;
    const next = new Float64Array(distribution.length + (ways.length - 1) * w);
    for (let x = 0; x < distribution.length; x++) {
      const px = distribution[x] as number;
      if (px === 0) continue;
      for (let s = 0; s < ways.length; s++) {
        const n = ways[s] as number;
        if (n !== 0) next[x + s * w] = (next[x + s * w] as number) + (px * n) / total;
      }
    }
    distribution = next;
  }
  let p = 0;
  for (let x = 0; x <= observed; x++) p += distribution[x] as number;
  return Math.min(1, p);
}

/** The Monte Carlo p-value from `resamples` within-case relabellings drawn with `rng`. */
function monteCarloP(
  cases: readonly UsedCase[],
  rng: Rng,
  resamples: number,
): ScorePermutationResult {
  const observed = sum(cases.map((c) => weightOf(c) * sum(c.candidate)));
  const pools = cases.map((c) => [...c.candidate, ...c.base]);
  let extreme = 0;
  for (let r = 0; r < resamples; r++) {
    let t = 0;
    for (const [i, c] of cases.entries()) {
      const pool = pools[i] as number[];
      let s = 0;
      // A partial Fisher–Yates shuffle: the first nC positions are the candidate's.
      for (let j = 0; j < c.candidate.length; j++) {
        const pick = j + Math.floor(rng.uniform() * (pool.length - j));
        const chosen = pool[pick] as number;
        pool[pick] = pool[j] as number;
        pool[j] = chosen;
        s += chosen;
      }
      t += weightOf(c) * s;
    }
    if (t <= observed + MONTE_CARLO_TOLERANCE) extreme++;
  }
  const p = (1 + extreme) / (1 + resamples);
  return {
    statistic: 0,
    p,
    method: "within-case-permutation-monte-carlo",
    resamples,
    monteCarloSE: Math.sqrt((p * (1 - p)) / resamples),
    seed: rng.seed,
  };
}

/**
 * Within-case permutation test of "no difference in any case" for scores in [0, 1] (R-P), on the
 * equal-weight mean of per-case differences in means, the fixed-cases estimand. Within each case
 * the pooled trials are reassigned to the arms, keeping each arm's completed count, and cases are
 * permuted independently. One-sided toward a drop; ties count as at most T observed.
 *
 * Exact by convolution when every value lies on a lattice of step 1/D with D at most 1,000, every
 * case has at most 100,000 labellings, and the support times the number of cases is at most 5·10^7.
 * Otherwise seeded Monte Carlo, p = (1 + count) / (1 + resamples), reported with its standard
 * error; a p within 3 standard errors of one of `levels` is computed again with 100,000 resamples
 * and a new seed. A case without a completed trial in an arm does not enter.
 */
export function scorePermutationTest(
  cases: readonly CaseScores[],
  options: ScorePermutationOptions = {},
): ScorePermutationResult {
  for (const c of cases) {
    for (const v of [...c.base, ...c.candidate]) {
      if (!(Number.isFinite(v) && v >= 0 && v <= 1))
        throw new RangeError(`case '${c.id}': score ${v} is not in [0, 1]`);
    }
  }
  const used = cases.filter((c) => c.base.length > 0 && c.candidate.length > 0);
  if (used.length === 0) throw new RangeError("no case has a completed trial in both arms");
  const statistic =
    sum(used.map((c) => sum(c.candidate) / c.candidate.length - sum(c.base) / c.base.length)) /
    used.length;
  const exact = exactP(used);
  if (exact !== undefined) return { statistic, p: exact, method: "within-case-permutation-exact" };

  const { rng, levels = [] } = options;
  if (!rng) throw new RangeError("this table needs a seeded generator for the Monte Carlo path");
  const first = monteCarloP(used, rng, options.resamples ?? SCORE_PERMUTATION_RESAMPLES);
  const se = first.monteCarloSE as number;
  const near = levels.some((level) => Math.abs(first.p - level) <= 3 * se);
  const result = near
    ? monteCarloP(
        used,
        createRng(((rng.seed + NEAR_LEVEL_SEED_OFFSET - 1) % 4294967295) + 1),
        SCORE_PERMUTATION_RESAMPLES_NEAR_LEVEL,
      )
    : first;
  return { ...result, statistic };
}
