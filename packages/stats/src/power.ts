import { qnorm } from "./normal.ts";
import type { Rng } from "./rng.ts";
import { scoreDifferenceInterval, type ScoreOptions, type Stratum } from "./score-difference.ts";
import { tangoInterval } from "./tango.ts";

function quantile(sorted: readonly number[], q: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index] as number;
}

/**
 * The smallest non-inferiority margin that can pass under `fixed-cases` when nothing changed and
 * every trial passes in both arms: the zero-noise floor of the stratified score bound. Real
 * within-case noise raises it.
 */
export function fixedCasesFloor(
  cases: number,
  replicates: number,
  alpha = 0.05,
  options: ScoreOptions = {},
): number {
  const strata: Stratum[] = Array.from({ length: cases }, () => ({
    candidate: { successes: replicates, trials: replicates },
    base: { successes: replicates, trials: replicates },
  }));
  return -scoreDifferenceInterval(strata, 1 - alpha, "lower", options).lower;
}

/** The same floor under `sampled-cases`: every pair concordant, Tango's bound. */
export function sampledCasesFloor(cases: number, alpha = 0.05): number {
  return -tangoInterval(
    { both: cases, candidateOnly: 0, baseOnly: 0, neither: 0 },
    1 - alpha,
    "lower",
  ).lower;
}

/** Approximate cases needed under `sampled-cases` for a margin at a discordance rate (true difference 0). */
export function sampledCasesNeeded(
  discordance: number,
  margin: number,
  alpha = 0.05,
  power = 0.8,
): number {
  const z = qnorm(1 - alpha) + qnorm(power);
  return Math.ceil((z * z * discordance) / (margin * margin));
}

/** Inputs of a simulated minimum detectable effect under `fixed-cases`. */
export interface FixedCasesMdeInput {
  /** Per-case pass rates of the last comparable run, or a declared assumption. */
  readonly rates: readonly number[];
  readonly replicates: number;
  readonly alpha?: number;
  readonly power?: number;
  readonly simulations?: number;
  readonly rng: Rng;
  readonly options?: ScoreOptions;
}

/**
 * The minimum detectable effect of the method itself, by simulation: with both arms drawn from
 * the same per-case rates (true difference 0), the margin that the non-inferiority test passes
 * with the stated power. It is the `power` quantile of the negated lower bound. No normal
 * approximation, so it is exact for the method up to Monte Carlo error.
 */
export function fixedCasesMde(input: FixedCasesMdeInput): {
  mde: number;
  floor: number;
  simulations: number;
} {
  const alpha = input.alpha ?? 0.05;
  const power = input.power ?? 0.8;
  const simulations = input.simulations ?? 2000;
  const draw = (rate: number): number => {
    let s = 0;
    for (let i = 0; i < input.replicates; i++) if (input.rng.uniform() < rate) s++;
    return s;
  };
  const needed: number[] = [];
  for (let k = 0; k < simulations; k++) {
    const strata = input.rates.map((rate) => ({
      candidate: { successes: draw(rate), trials: input.replicates },
      base: { successes: draw(rate), trials: input.replicates },
    }));
    needed.push(-scoreDifferenceInterval(strata, 1 - alpha, "lower", input.options).lower);
  }
  needed.sort((a, b) => a - b);
  return {
    mde: quantile(needed, power),
    floor: fixedCasesFloor(input.rates.length, input.replicates, alpha, input.options),
    simulations,
  };
}
