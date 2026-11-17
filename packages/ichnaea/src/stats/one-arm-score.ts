import { critical } from "./normal.ts";
import { lowerRoot } from "./solve.ts";
import { assertLevel, type Interval, type Sided } from "./types.ts";

/** One case's values in one arm: their sum, their count and the case's weight in the mean. */
export interface ScoreCell {
  /** The sum of the case's values, each in [0, 1]: a count of passes for binary values. */
  readonly sum: number;
  /** The number of values, at least 1. */
  readonly trials: number;
  /** The case's weight in the mean; the weights of all cells sum to 1. */
  readonly weight: number;
}

/**
 * The case rate pᵢ that maximises the likelihood under the constraint Σ wⱼpⱼ = θ, at the scaled
 * multiplier c = λwᵢ: the root in [0, 1] of c·p² − (r + c)·p + s = 0, in the form that stays exact
 * as c → 0. A case with no pass has p = 0 until c < −r, where p = 1 + r/c.
 */
function restrictedRate(sum: number, trials: number, c: number): number {
  if (sum === 0) return c < -trials ? 1 + trials / c : 0;
  const b = trials + c;
  return (2 * sum) / (b + Math.sqrt(b * b - 4 * c * sum));
}

/** The restricted rates at the mean θ, with the multiplier found by bisection. */
function restrictedRates(cells: readonly ScoreCell[], theta: number): number[] {
  const at = (lambda: number): number[] =>
    cells.map((cell) => restrictedRate(cell.sum, cell.trials, lambda * cell.weight));
  const mean = (rates: readonly number[]): number =>
    rates.reduce((a, p, i) => a + cells[i]!.weight * p, 0);
  // The weighted mean of the rates falls from 1 to 0 as the multiplier rises.
  let low = -1;
  let high = 1;
  while (mean(at(low)) < theta) low *= 2;
  while (mean(at(high)) > theta) high *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    if (mid === low || mid === high) break;
    if (mean(at(mid)) > theta) low = mid;
    else high = mid;
  }
  return at((low + high) / 2);
}

function lowerBound(cells: readonly ScoreCell[], estimate: number, target: number): number {
  if (estimate === 0) return 0;
  const statistic = (theta: number): number => {
    if (theta <= 0) return Number.POSITIVE_INFINITY;
    if (theta >= 1) return Number.NEGATIVE_INFINITY;
    const rates = restrictedRates(cells, theta);
    const variance = rates.reduce(
      (a, p, i) => a + (cells[i]!.weight ** 2 * p * (1 - p)) / cells[i]!.trials,
      0,
    );
    const numerator = estimate - theta;
    if (variance <= 0) return numerator > 0 ? Infinity : numerator < 0 ? -Infinity : 0;
    return numerator / Math.sqrt(variance);
  };
  return lowerRoot(statistic, target, 0, 1);
}

/**
 * The one-arm stratified score interval for a weighted mean of case rates, Σ wᵢpᵢ: it
 * inverts (θ̂ − θ)/√V(θ), with V(θ) = Σ wᵢ²·p̃ᵢ(1 − p̃ᵢ)/rᵢ at the rates p̃ᵢ that maximise the
 * likelihood under Σ wᵢp̃ᵢ = θ. It has no small-sample factor. For one case it is Wilson. Values in
 * [0, 1] enter as fractional sums, with the variance bound μ(1 − μ). Its coverage is not validated.
 */
export function oneArmScoreInterval(
  cells: readonly ScoreCell[],
  level = 0.95,
  sided: Sided = "two",
): Interval {
  assertLevel(level);
  if (cells.length === 0) throw new RangeError("oneArmScoreInterval needs at least one case");
  let total = 0;
  for (const { sum, trials, weight } of cells) {
    if (!(Number.isInteger(trials) && trials >= 1))
      throw new RangeError(`oneArmScoreInterval: ${trials} trials is not a positive integer`);
    if (!(Number.isFinite(sum) && sum >= 0 && sum <= trials))
      throw new RangeError(`oneArmScoreInterval: sum ${sum} is not in [0, ${trials}]`);
    if (!(Number.isFinite(weight) && weight > 0))
      throw new RangeError(`oneArmScoreInterval: weight ${weight} is not positive`);
    total += weight;
  }
  if (Math.abs(total - 1) > 1e-9)
    throw new RangeError(`oneArmScoreInterval: weights sum to ${total}, not 1`);
  const estimate = cells.reduce((a, c) => a + (c.weight * c.sum) / c.trials, 0);
  const target = critical(level, sided);
  const flipped = cells.map((c) => ({ ...c, sum: c.trials - c.sum }));
  return {
    estimate,
    lower: sided === "upper" ? 0 : lowerBound(cells, estimate, target),
    upper: sided === "lower" ? 1 : 1 - lowerBound(flipped, 1 - estimate, target),
    level,
    sided,
    method: "one-arm-stratified-score",
  };
}
