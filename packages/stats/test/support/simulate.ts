// Monte Carlo harness for coverage and type-I error, with tolerances from the Monte Carlo
// standard error (REQ-50, REQ-111).
import { createRng, type Rng } from "../../src/index.ts";

/** Repetitions per grid point: 2,000 on pull requests, 10,000 nightly (ICHNAEA_SIM_REPS). */
export const REPS: number = Number(process.env["ICHNAEA_SIM_REPS"] ?? 2000);

/** One grid point's result. */
export interface PointResult {
  readonly label: string;
  readonly reps: number;
  readonly coverage: number;
  readonly mcse: number;
}

/** Runs `reps` repetitions of a coverage experiment with its own seeded generator. */
export function coverage(
  label: string,
  seed: number,
  reps: number,
  covers: (rng: Rng) => boolean,
): PointResult {
  const rng = createRng(seed);
  let hits = 0;
  for (let i = 0; i < reps; i++) if (covers(rng)) hits++;
  const p = hits / reps;
  return { label, reps, coverage: p, mcse: Math.sqrt((p * (1 - p)) / reps) };
}

/** The rule every interval must pass over a grid. */
export interface Verdict {
  readonly failures: string[];
  readonly mean: number;
  readonly minimum: number;
  readonly meanTolerance: number;
  readonly pointTolerance: number;
}

/**
 * No point may fall below nominal by more than 3 Monte Carlo standard errors (computed at the
 * nominal level), and the grid mean may not fall below nominal by more than 3 standard errors of
 * the mean.
 */
export function judge(results: readonly PointResult[], nominal: number): Verdict {
  const reps = results[0]?.reps ?? 1;
  const pointTolerance = 3 * Math.sqrt((nominal * (1 - nominal)) / reps);
  const meanTolerance = pointTolerance / Math.sqrt(results.length);
  const mean = results.reduce((a, r) => a + r.coverage, 0) / results.length;
  const failures = results
    .filter((r) => r.coverage < nominal - pointTolerance)
    .map((r) => `${r.label}: ${r.coverage.toFixed(4)}`);
  if (mean < nominal - meanTolerance)
    failures.push(`grid mean ${mean.toFixed(4)} < ${nominal} - ${meanTolerance.toFixed(4)}`);
  return {
    failures,
    mean,
    minimum: Math.min(...results.map((r) => r.coverage)),
    meanTolerance,
    pointTolerance,
  };
}

/** A binomial draw by summing Bernoulli trials (small n only). */
export function binomial(rng: Rng, n: number, p: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) if (rng.uniform() < p) s++;
  return s;
}
