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
  return zeroNoiseFloor(
    Array.from({ length: cases }, () => replicates),
    alpha,
    options,
  );
}

/**
 * The zero-noise floor for any trial count per case (every case passes every trial in both arms),
 * with equal case weights as `compareCounts` uses them. `trials[j]` is case j's trials per arm.
 */
export function zeroNoiseFloor(
  trials: readonly number[],
  alpha = 0.05,
  options: ScoreOptions = {},
): number {
  const strata: Stratum[] = trials.map((r) => ({
    candidate: { successes: r, trials: r },
    base: { successes: r, trials: r },
  }));
  return -scoreDifferenceInterval(strata, 1 - alpha, "lower", { weights: "equal", ...options })
    .lower;
}

/** The same floor under `sampled-cases`: every pair concordant, the skewness-corrected Tango bound. */
export function sampledCasesFloor(cases: number, alpha = 0.05): number {
  return -tangoInterval(
    { both: cases, candidateOnly: 0, baseOnly: 0, neither: 0 },
    1 - alpha,
    "lower",
    true,
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
  /** Trials per case and arm: one count for every case, or one per case. */
  readonly replicates: number | readonly number[];
  /** The one-sided level of the non-inferiority test. Default 0.05. */
  readonly alpha?: number;
  /** The power at which the margin must pass. Default 0.8. */
  readonly power?: number;
  /** The number of simulated runs. Default 2000. */
  readonly simulations?: number;
  /** The seeded generator that draws the simulated trials. */
  readonly rng: Rng;
  /** Options of the score method; the weights default to `equal`. */
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
  const trials = input.rates.map((_, j) =>
    typeof input.replicates === "number" ? input.replicates : (input.replicates[j] as number),
  );
  const draw = (rate: number, r: number): number => {
    let s = 0;
    for (let i = 0; i < r; i++) if (input.rng.uniform() < rate) s++;
    return s;
  };
  const needed: number[] = [];
  for (let k = 0; k < simulations; k++) {
    const strata = input.rates.map((rate, j) => {
      const r = trials[j] as number;
      return {
        candidate: { successes: draw(rate, r), trials: r },
        base: { successes: draw(rate, r), trials: r },
      };
    });
    needed.push(
      -scoreDifferenceInterval(strata, 1 - alpha, "lower", { weights: "equal", ...input.options })
        .lower,
    );
  }
  needed.sort((a, b) => a - b);
  return {
    mde: quantile(needed, power),
    floor: zeroNoiseFloor(trials, alpha, input.options),
    simulations,
  };
}
