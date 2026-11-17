import { critical } from "./normal.ts";
import { assertCount, assertLevel, type Count, type Interval, type Sided } from "./types.ts";

/**
 * The Wilson score interval for one proportion. Never Wald: Wald intervals undercover badly
 * below a few hundred trials. Zero trials give [0, 1] with an undefined (NaN) estimate.
 */
export function wilson(count: Count, level = 0.95, sided: Sided = "two"): Interval {
  assertCount(count, "wilson");
  assertLevel(level);
  const { successes: x, trials: n } = count;
  if (n === 0) return { estimate: Number.NaN, lower: 0, upper: 1, level, sided, method: "wilson" };
  return wilsonInterval(x / n, n, level, sided, "wilson");
}

/**
 * The Wilson interval on a mean of n values in [0, 1], with n as the count: the pooled mean of
 * scores at one trial per case. Its variance bound μ(1 − μ) holds for any value in [0, 1],
 * but its coverage is not guaranteed (minimum 0.838 in VALIDATION.md), so it is not validated.
 */
export function wilsonMean(mean: number, n: number, level = 0.95, sided: Sided = "two"): Interval {
  if (!(Number.isFinite(mean) && mean >= 0 && mean <= 1))
    throw new RangeError(`wilsonMean: mean ${mean} is not in [0, 1]`);
  if (!(Number.isFinite(n) && n > 0)) throw new RangeError(`wilsonMean: n ${n} is not positive`);
  assertLevel(level);
  return wilsonInterval(mean, n, level, sided, "wilson-mean");
}

function wilsonInterval(
  p: number,
  n: number,
  level: number,
  sided: Sided,
  method: string,
): Interval {
  const z = critical(level, sided);
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const lower = p === 0 ? 0 : Math.max(0, centre - half);
  const upper = p === 1 ? 1 : Math.min(1, centre + half);
  return {
    estimate: p,
    lower: sided === "upper" ? 0 : lower,
    upper: sided === "lower" ? 1 : upper,
    level,
    sided,
    method,
  };
}
