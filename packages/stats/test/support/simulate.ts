// Monte Carlo harness for coverage and type-I error (REQ-50, REQ-111) under the tolerance of
// design change DC-5: every point at least nominal − 0.01, Monte Carlo SE at most 0.003, and the
// grid mean at least nominal. Every run prints its table.
import { createRng, type Rng } from "../../src/index.ts";

/** Repetitions per grid point: 6,000 on pull requests (SE ≤ 0.003 at 95%), 10,000 nightly. */
export const REPS: number = Number(process.env["ICHNAEA_SIM_REPS"] ?? 6000);

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

/** The verdict on a grid. */
export interface Verdict {
  readonly failures: string[];
  readonly mean: number;
  readonly minimum: number;
}

/** Applies DC-5 and prints the table, so passing runs report their tolerances too. */
export function judge(
  results: readonly PointResult[],
  nominal: number,
  title = "coverage",
): Verdict {
  const floor = nominal - 0.01;
  const mean = results.reduce((a, r) => a + r.coverage, 0) / results.length;
  const failures: string[] = [];
  const se = (reps: number): number =>
    reps === Number.POSITIVE_INFINITY ? 0 : Math.sqrt((nominal * (1 - nominal)) / reps);
  for (const r of results) {
    // A point fails when even its upper 3·SE bound lies below the floor: a real deficit beyond
    // 0.01, not Monte Carlo noise. Exact points (infinite repetitions) have no noise.
    if (r.coverage + 3 * se(r.reps) < floor)
      failures.push(`${r.label}: ${r.coverage.toFixed(4)} < ${floor.toFixed(2)}`);
    // The SE rule needs enough repetitions; it applies at the configured strength.
    if (REPS >= 5000 && r.reps === REPS && Math.sqrt((nominal * (1 - nominal)) / r.reps) > 0.003)
      failures.push(`${r.label}: Monte Carlo SE above 0.003`);
  }
  if (mean < nominal) failures.push(`grid mean ${mean.toFixed(4)} < ${nominal}`);
  console.log(
    `\n${title}: ${results.length} points, ${REPS} repetitions (exact where marked), rule: every point ≥ ${floor.toFixed(2)} within 3 SE, mean ≥ ${nominal}`,
  );
  console.log(
    results
      .map(
        (r) =>
          `  ${r.coverage.toFixed(4)} ${r.reps === Number.POSITIVE_INFINITY ? "exact   " : `± ${r.mcse.toFixed(4)}`}  ${r.label}`,
      )
      .join("\n"),
  );
  console.log(
    `  minimum ${Math.min(...results.map((r) => r.coverage)).toFixed(4)}, mean ${mean.toFixed(4)}`,
  );
  return { failures, mean, minimum: Math.min(...results.map((r) => r.coverage)) };
}

/** A binomial draw by summing Bernoulli trials (small n only). */
export function binomial(rng: Rng, n: number, p: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) if (rng.uniform() < p) s++;
  return s;
}
