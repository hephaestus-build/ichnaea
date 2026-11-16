// The score permutation test with every setting. Internal: the package index does not export it.
// The public `scorePermutationTest` (score-permutation.ts) takes a seed and no resample count or
// switch to Monte Carlo, so a decision always runs the shipped settings; the type-I study uses this
// entry point to run Monte Carlo with 99 resamples on its own generator.
import { createRng, type Rng } from "./rng.ts";

/**
 * One case's completed trial values under both arms, each a score in [0, 1]. A proportion arrives
 * already reduced to one value per trial: its items are never trials (decision 0008).
 */
export interface CaseScores {
  /** The case's ID. */
  readonly id: string;
  /** The case's family, a group of related cases; absent means the case is a family of its own. */
  readonly family?: string;
  /** The case's completed trial values under the base arm. */
  readonly base: readonly number[];
  /** The case's completed trial values under the candidate arm. */
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
  /** The test's stable name: the exact path or the Monte Carlo path. */
  readonly method: "within-case-permutation-exact" | "within-case-permutation-monte-carlo";
  /**
   * The exact path's work estimate W (SCORE_PERMUTATION_WORK_LIMIT), when the values lie on a
   * lattice and every case is within the per-case limits; the exact path ran if W was at most the
   * limit. Absent when the values or a case rule the exact path out before W can be computed.
   */
  readonly work?: number;
  /** Monte Carlo only: the resamples behind `p`. */
  readonly resamples?: number;
  /** Monte Carlo only: the standard error of `p`. */
  readonly monteCarloSE?: number;
  /** Monte Carlo only: the seed of the generator behind `p`. */
  readonly seed?: number;
}

/** Every setting of the score permutation test. */
export interface ScorePermutationSettings {
  /**
   * Generator for the Monte Carlo path, required when the exact path does not run. The result
   * records its seed, which reproduces `p` only when the generator was fresh.
   */
  readonly rng?: Rng;
  /** Monte Carlo resamples. */
  readonly resamples?: number;
  /**
   * The levels the p-value will be compared with: alpha, or each level Holm may compare it with.
   * A Monte Carlo p within 3 standard errors of one of them is computed again with
   * SCORE_PERMUTATION_RESAMPLES_NEAR_LEVEL resamples and the seed `rerunSeed(seed)`, and that
   * result is reported.
   */
  readonly levels?: readonly number[];
  /** Whether to enumerate when that is cheap (default true). `false` always runs Monte Carlo. */
  readonly exact?: boolean;
}

/** Monte Carlo resamples of the score permutation test when it cannot enumerate. */
export const SCORE_PERMUTATION_RESAMPLES = 10_000;
/** Monte Carlo resamples when the p-value lies within 3 standard errors of a level. */
export const SCORE_PERMUTATION_RESAMPLES_NEAR_LEVEL = 100_000;
/**
 * Largest work estimate W of the exact path. W is the sum over cases, in the order the convolution
 * takes them, of (the support of the partial distribution before the case) × (the number of
 * distinct contributions of the case): the multiply-adds the convolution performs. Set from the
 * benchmark in VALIDATION.md so that the slowest exact case stays near 1 second on a CI runner.
 */
export const SCORE_PERMUTATION_WORK_LIMIT = 50_000_000;

/** Largest lattice denominator the exact path looks for: every value must be a multiple of 1/D. */
const MAX_DENOMINATOR = 1000;
/** Largest number of label assignments of one case on the exact path. */
const MAX_ASSIGNMENTS = 100_000;
const LATTICE_TOLERANCE = 1e-9;
/** Floating tolerance of the Monte Carlo comparison: ties count as at most T observed. */
const MONTE_CARLO_TOLERANCE = 1e-9;
/** Added to the seed of a Monte Carlo test that is computed again near a level. */
const NEAR_LEVEL_SEED_OFFSET = 1_000_003;
/** The generator's seeds are 1 to 2^32 − 1. */
const SEED_MODULUS = 4_294_967_295;

/** The seed of the rerun near a level: (seed + 1,000,003) mod (2^32 − 1), and 1 if that is 0. */
export function rerunSeed(seed: number): number {
  const next = (seed + NEAR_LEVEL_SEED_OFFSET) % SEED_MODULUS;
  return next === 0 ? 1 : next;
}

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
 * smallest possible sum to the largest: a dynamic programme over the values. Its cost grows with
 * `picks`, so callers pick the smaller arm.
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

/** One case on the exact path: its weight, its ways per candidate sum, and its observed offset. */
interface LatticeCase {
  readonly weight: number;
  /** Ways per candidate sum, from the smallest possible candidate sum. */
  readonly ways: Float64Array;
  readonly labellings: number;
  /** The observed candidate sum minus the smallest possible one, in lattice units. */
  readonly observed: number;
  readonly distinct: number;
}

/**
 * The exact path's plan: every case on the values' lattice, in the order the convolution takes
 * them, and the work estimate W. Undefined when the values are off every small lattice or a case
 * has too many labellings.
 *
 * Up to a constant and the factor 1/k, T is the sum over cases of w·(candidate sum), and the
 * candidate sums of different cases are independent under the permutation. With every value a
 * multiple of 1/D and M the least common multiple of the products nC·nB, each M·w·D·(candidate sum)
 * is an integer, so the null distribution of T is a convolution of integer distributions.
 */
function latticePlan(
  cases: readonly UsedCase[],
): { readonly cases: readonly LatticeCase[]; readonly work: number } | undefined {
  const d = latticeDenominator(cases.flatMap((c) => [...c.base, ...c.candidate]));
  if (d === undefined) return undefined;
  const labellings = cases.map((c) =>
    choose(c.base.length + c.candidate.length, c.candidate.length),
  );
  if (labellings.some((n) => n > MAX_ASSIGNMENTS)) return undefined;
  const m = cases.reduce((acc, c) => lcm(acc, c.candidate.length * c.base.length), 1);
  const raw = cases.map((c) => Math.round(m * weightOf(c)));
  const common = raw.reduce((acc, w) => gcd(acc, w), 0);
  const planned: LatticeCase[] = cases.map((c, i) => {
    const candidate = c.candidate.map((v) => Math.round(v * d));
    const base = c.base.map((v) => Math.round(v * d));
    const pooled = [...candidate, ...base];
    const total = sum(pooled);
    // Picking the smaller arm costs less; the candidate's sum is then the total minus the base's.
    const ways =
      candidate.length <= base.length
        ? subsetSums(pooled, candidate.length)
        : subsetSums(pooled, base.length).toReversed();
    const lowest = total - sum(pooled.toSorted((a, b) => b - a).slice(0, base.length));
    return {
      weight: (raw[i] as number) / common,
      ways,
      labellings: labellings[i] as number,
      observed: sum(candidate) - lowest,
      distinct: ways.reduce((a, n) => a + (n === 0 ? 0 : 1), 0),
    };
  });
  // A canonical order, from the table alone: the case order never changes the path or the work.
  const ordered = planned.toSorted(
    (a, b) =>
      a.weight * (a.ways.length - 1) - b.weight * (b.ways.length - 1) ||
      a.distinct - b.distinct ||
      a.weight - b.weight,
  );
  let support = 1;
  let work = 0;
  for (const c of ordered) {
    work += support * c.distinct;
    support += c.weight * (c.ways.length - 1);
  }
  return { cases: ordered, work };
}

/** The exact p-value of a plan, by convolution. */
function exactP(plan: { readonly cases: readonly LatticeCase[] }): number {
  // The observed statistic and the distribution, both shifted so that the smallest sum is 0.
  let observed = 0;
  let distribution = Float64Array.of(1);
  for (const c of plan.cases) {
    observed += c.weight * c.observed;
    if (c.ways.length === 1) continue; // Every labelling gives this case the same contribution.
    const w = c.weight;
    // Only the case's distinct contributions: the work is the support times their number, W.
    const offsets: number[] = [];
    const masses: number[] = [];
    for (let s = 0; s < c.ways.length; s++) {
      const n = c.ways[s] as number;
      if (n === 0) continue;
      offsets.push(s * w);
      masses.push(n / c.labellings);
    }
    const next = new Float64Array(distribution.length + (c.ways.length - 1) * w);
    for (let x = 0; x < distribution.length; x++) {
      const px = distribution[x] as number;
      if (px === 0) continue;
      for (let j = 0; j < offsets.length; j++) {
        const at = x + (offsets[j] as number);
        next[at] = (next[at] as number) + px * (masses[j] as number);
      }
    }
    distribution = next;
  }
  let p = 0;
  for (let x = 0; x <= observed; x++) p += distribution[x] as number;
  return Math.min(1, p);
}

/**
 * The exact path's work estimate W for a table, or undefined when the values are off every small
 * lattice or a case has too many labellings. Internal, for the tests and the benchmark.
 */
export function exactWork(cases: readonly CaseScores[]): number | undefined {
  return latticePlan(cases.filter((c) => c.base.length > 0 && c.candidate.length > 0))?.work;
}

/**
 * The exact p-value whatever its work, or undefined when the values are off every small lattice or
 * a case has too many labellings. Internal, for the benchmark that sets the work limit and for the
 * tests; the test itself never runs the exact path above the limit.
 */
export function exactPathIgnoringWork(
  cases: readonly CaseScores[],
): { readonly p: number; readonly work: number } | undefined {
  const plan = latticePlan(cases.filter((c) => c.base.length > 0 && c.candidate.length > 0));
  return plan === undefined ? undefined : { p: exactP(plan), work: plan.work };
}

/** The Monte Carlo p-value from `resamples` within-case relabellings drawn with `rng`. */
function monteCarloP(
  cases: readonly UsedCase[],
  rng: Rng,
  resamples: number,
): { p: number; resamples: number; monteCarloSE: number; seed: number } {
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
  return { p, resamples, monteCarloSE: Math.sqrt((p * (1 - p)) / resamples), seed: rng.seed };
}

/**
 * Within-case permutation test of "no difference in any case" for scores in [0, 1] (R-P), on the
 * equal-weight mean of per-case differences in means, the fixed-cases estimand. Within each case
 * the pooled trials are reassigned to the arms, keeping each arm's completed count, and cases are
 * permuted independently. One-sided toward a drop; ties count as at most T observed.
 *
 * Exact by convolution when every value lies on a lattice of step 1/D with D at most 1,000, every
 * case has at most 100,000 labellings, and the work estimate W is at most
 * SCORE_PERMUTATION_WORK_LIMIT. Otherwise seeded Monte Carlo, p = (1 + count) / (1 + resamples),
 * reported with its standard error and seed; a p within 3 standard errors of one of `levels` is
 * computed again with 100,000 resamples and the seed `rerunSeed(seed)`, and that result is
 * reported. A case without a completed trial in an arm does not enter.
 */
export function scorePermutationCore(
  cases: readonly CaseScores[],
  options: ScorePermutationSettings = {},
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
  const plan = options.exact === false ? undefined : latticePlan(used);
  const work = plan === undefined ? {} : { work: plan.work };
  if (plan !== undefined && plan.work <= SCORE_PERMUTATION_WORK_LIMIT)
    return { statistic, p: exactP(plan), method: "within-case-permutation-exact", ...work };

  const { rng, levels = [] } = options;
  if (!rng) throw new RangeError("this table needs a seeded generator for the Monte Carlo path");
  const first = monteCarloP(used, rng, options.resamples ?? SCORE_PERMUTATION_RESAMPLES);
  const near = levels.some((level) => Math.abs(first.p - level) <= 3 * first.monteCarloSE);
  const result = near
    ? monteCarloP(used, createRng(rerunSeed(rng.seed)), SCORE_PERMUTATION_RESAMPLES_NEAR_LEVEL)
    : first;
  return { statistic, ...result, method: "within-case-permutation-monte-carlo", ...work };
}
