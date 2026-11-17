import { assertLevel, type Interval, type Sided } from "./types.ts";

/**
 * Hoeffding's bound for a weighted mean Σ wᵢYᵢ of independent terms in [0, 1], with weights that
 * sum to 1: half-width √(ln(2/α)·Σwᵢ²/2) on two sides, √(ln(1/α)·Σwᵢ²/2) on one, clipped to
 * [0, 1]. Its coverage holds at every set of means, so it is conservative. It is the
 * interval where unequal weights leave no binomial count to invert.
 */
export function hoeffding(
  values: readonly number[],
  weights: readonly number[],
  level = 0.95,
  sided: Sided = "two",
): Interval {
  assertLevel(level);
  if (values.length === 0 || values.length !== weights.length)
    throw new RangeError("hoeffding needs one weight per value, and at least one value");
  let total = 0;
  let point = 0;
  let squares = 0;
  values.forEach((value, i) => {
    const weight = weights[i]!;
    if (!(Number.isFinite(value) && value >= 0 && value <= 1))
      throw new RangeError(`hoeffding: value ${value} is not in [0, 1]`);
    if (!(Number.isFinite(weight) && weight > 0))
      throw new RangeError(`hoeffding: weight ${weight} is not positive`);
    total += weight;
    point += weight * value;
    squares += weight * weight;
  });
  if (Math.abs(total - 1) > 1e-9) throw new RangeError(`hoeffding: weights sum to ${total}, not 1`);
  // Divided by the same weights' sum, the mean stays inside [0, 1] in floating point.
  const mean = point / total;
  const alpha = 1 - level;
  const half = Math.sqrt((Math.log((sided === "two" ? 2 : 1) / alpha) * squares) / 2);
  return {
    estimate: mean,
    lower: sided === "upper" ? 0 : Math.max(0, mean - half),
    upper: sided === "lower" ? 1 : Math.min(1, mean + half),
    level,
    sided,
    method: "hoeffding",
  };
}
