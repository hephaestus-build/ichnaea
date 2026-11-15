import type { Rng } from "./rng.ts";
import { assertLevel, type Interval, type Sided, type TestResult } from "./types.ts";

/** Above this many families, sign-flip tests sample flips instead of enumerating them. */
export const EXACT_SIGN_FLIP_LIMIT = 16;
/** Monte Carlo resamples when a randomisation test cannot enumerate. */
export const DEFAULT_RESAMPLES = 10_000;

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sign patterns: every pattern up to the exact limit, otherwise `resamples` random ones. */
function signPatterns(
  count: number,
  rng: Rng | undefined,
  resamples: number,
): { patterns: Int8Array[]; exact: boolean } {
  if (count <= EXACT_SIGN_FLIP_LIMIT) {
    const patterns: Int8Array[] = [];
    for (let mask = 0; mask < 2 ** count; mask++) {
      const signs = new Int8Array(count);
      for (let i = 0; i < count; i++) signs[i] = mask & (1 << i) ? -1 : 1;
      patterns.push(signs);
    }
    return { patterns, exact: true };
  }
  if (!rng) throw new Error(`a sign-flip test over ${count} families needs a seeded generator`);
  const patterns: Int8Array[] = [];
  for (let r = 0; r < resamples; r++) {
    const signs = new Int8Array(count);
    for (let i = 0; i < count; i++) signs[i] = rng.uniform() < 0.5 ? -1 : 1;
    patterns.push(signs);
  }
  return { patterns, exact: false };
}

/**
 * Sign-flip randomisation test on family-level differences. Under H0 (difference = delta0) the
 * centred differences are symmetric, so their signs are exchangeable. The p-value counts the
 * observed pattern, so it is never zero ((1 + count) / (1 + resamples) when sampling).
 */
function signFlipP(
  diffs: readonly number[],
  delta0: number,
  alternative: "greater" | "less",
  patterns: readonly Int8Array[],
  exact: boolean,
): number {
  const centred = diffs.map((d) => d - delta0);
  const observed = mean(centred);
  const tolerance = 1e-12 * Math.max(1, Math.abs(observed));
  let extreme = 0;
  for (const signs of patterns) {
    let sum = 0;
    for (let i = 0; i < centred.length; i++) sum += (signs[i] as number) * (centred[i] as number);
    const stat = sum / centred.length;
    if (alternative === "greater" ? stat >= observed - tolerance : stat <= observed + tolerance)
      extreme++;
  }
  return exact ? extreme / patterns.length : (1 + extreme) / (1 + patterns.length);
}

/** Options of a randomisation test. */
export interface RandomisationOptions {
  readonly rng?: Rng;
  readonly resamples?: number;
}

/** One-sided sign-flip test of family-level differences against delta0. */
export function signFlipTest(
  diffs: readonly number[],
  delta0: number,
  alternative: "greater" | "less",
  options: RandomisationOptions = {},
): TestResult {
  if (diffs.length === 0) return { statistic: 0, p: 1, method: "sign-flip" };
  const { patterns, exact } = signPatterns(
    diffs.length,
    options.rng,
    options.resamples ?? DEFAULT_RESAMPLES,
  );
  return {
    statistic: mean(diffs) - delta0,
    p: signFlipP(diffs, delta0, alternative, patterns, exact),
    method: exact ? "sign-flip-exact" : "sign-flip-mc",
  };
}

/**
 * The interval from inverting the sign-flip test: every delta0 that the one-sided tests do not
 * reject. The same sign patterns serve every delta0, so the bounds are stable.
 */
export function signFlipInterval(
  diffs: readonly number[],
  level = 0.95,
  sided: Sided = "two",
  options: RandomisationOptions = {},
): Interval {
  assertLevel(level);
  const method = "sign-flip-inverted";
  if (diffs.length === 0)
    return { estimate: Number.NaN, lower: -Infinity, upper: Infinity, level, sided, method };
  const { patterns, exact } = signPatterns(
    diffs.length,
    options.rng,
    options.resamples ?? DEFAULT_RESAMPLES,
  );
  const alpha = sided === "two" ? (1 - level) / 2 : 1 - level;
  const estimate = mean(diffs);
  const spread = Math.max(...diffs) - Math.min(...diffs) + Math.abs(estimate) + 1;
  // Lower bound: the smallest delta0 where H0: diff <= delta0 is no longer rejected.
  const rejectsBelow = (d: number): boolean =>
    signFlipP(diffs, d, "greater", patterns, exact) <= alpha;
  const rejectsAbove = (d: number): boolean =>
    signFlipP(diffs, d, "less", patterns, exact) <= alpha;
  const lower =
    sided === "upper" ? -Infinity : boundary(rejectsBelow, estimate - spread, estimate, "lower");
  const upper =
    sided === "lower" ? Infinity : boundary(rejectsAbove, estimate, estimate + spread, "upper");
  return {
    estimate,
    lower,
    upper,
    level,
    sided,
    method: exact ? `${method}-exact` : `${method}-mc`,
  };
}

function boundary(
  rejects: (d: number) => boolean,
  lo: number,
  hi: number,
  side: "lower" | "upper",
): number {
  // Lower side: rejects(lo) is true and rejects(hi) false; find the switch point.
  let a = lo;
  let b = hi;
  if (side === "lower" && !rejects(a)) return -Infinity;
  if (side === "upper" && !rejects(b)) return Infinity;
  for (let i = 0; i < 100 && b - a > 1e-12; i++) {
    const mid = (a + b) / 2;
    if (rejects(mid) === (side === "lower")) a = mid;
    else b = mid;
  }
  return side === "lower" ? b : a;
}
