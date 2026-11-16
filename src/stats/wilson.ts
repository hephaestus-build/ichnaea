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
  const method = "wilson";
  if (n === 0) return { estimate: Number.NaN, lower: 0, upper: 1, level, sided, method };
  const z = critical(level, sided);
  const p = x / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const lower = x === 0 ? 0 : Math.max(0, centre - half);
  const upper = x === n ? 1 : Math.min(1, centre + half);
  return {
    estimate: p,
    lower: sided === "upper" ? 0 : lower,
    upper: sided === "lower" ? 1 : upper,
    level,
    sided,
    method,
  };
}
