// Monte Carlo harness for coverage and type-I error (REQ-50, REQ-111) under the two-stage rule of
// validation rule (decision 0006). Every run prints its table and the thresholds in effect.
import { createRng, type Rng } from "../../../src/stats/index.ts";

/** Screening repetitions per grid point: 6,000 on pull requests, 10,000 nightly. */
export const REPS: number = Number(process.env["ICHNAEA_SIM_REPS"] ?? 6000);
/** A confirmation runs until its Monte Carlo standard error is at most this. */
export const CONFIRM_SE = 0.0005;
/** Confirmation seeds are the point's seed plus this, so they never share a stream. */
export const CONFIRM_SEED_OFFSET = 100_000;
/**
 * Coverage only: more candidates than this means the interval misses the bar broadly, and the gate
 * fails without spending hours confirming each one. This is stricter than the rule, which confirms
 * every candidate (VALIDATION.md says so). Type-I grids confirm every candidate: a valid test whose
 * size is just under 0.05 makes most points candidates.
 */
export const MAX_CANDIDATES = 12;

/** One grid point: a Monte Carlo experiment, or an exactly computed value. */
export interface Point {
  readonly label: string;
  readonly seed: number;
  /** One repetition: true when the event happens (the bound covers, or the test rejects). */
  readonly run?: (rng: Rng) => boolean;
  /** The exact probability of the event, where enumeration is cheap. */
  readonly exact?: number;
}

/** A point's estimate after screening and, for a candidate, confirmation. */
export interface Estimate {
  readonly label: string;
  readonly value: number;
  readonly se: number;
  readonly reps: number | "exact";
  readonly stage: "exact" | "screen" | "confirmed";
}

/** The verdict on a grid. */
export interface Verdict {
  readonly title: string;
  readonly failures: string[];
  readonly estimates: readonly Estimate[];
}

/** The probability of the event over `reps` repetitions from one seed. */
export function estimate(run: (rng: Rng) => boolean, seed: number, reps: number): number {
  const rng = createRng(seed);
  let hits = 0;
  for (let i = 0; i < reps; i++) if (run(rng)) hits++;
  return hits / reps;
}

const se = (p: number, n: number): number => Math.sqrt((p * (1 - p)) / n);

/**
 * Confirms a candidate with an independent seed: repetitions in batches until the standard error
 * is at most CONFIRM_SE.
 */
function confirm(point: Point): Estimate {
  const run = point.run as (rng: Rng) => boolean;
  const rng = createRng(point.seed + CONFIRM_SEED_OFFSET);
  let hits = 0;
  let reps = 0;
  const batch = 50_000;
  do {
    for (let i = 0; i < batch; i++) if (run(rng)) hits++;
    reps += batch;
  } while (se(hits / reps, reps) > CONFIRM_SE);
  return {
    label: point.label,
    value: hits / reps,
    se: se(hits / reps, reps),
    reps,
    stage: "confirmed",
  };
}

/** The two-stage rule for one kind of grid. */
export interface Rule {
  readonly kind: "coverage" | "type-I";
  readonly nominal: number;
  /** Passes at screening. */
  readonly clears: (value: number, se: number) => boolean;
  /** Fails after confirmation (or exactly). */
  readonly fails: (value: number, se: number) => boolean;
  readonly text: string;
}

/** Coverage at nominal 0.95 with a tolerance of 0.01 (decision 0006). */
export const COVERAGE: Rule = {
  kind: "coverage",
  nominal: 0.95,
  clears: (c, s) => c >= 0.94 + 2 * s,
  fails: (c, s) => c + 3 * s < 0.94,
  text: "screen passes at ≥ 0.94 + 2·SE; a confirmed point (SE ≤ 0.0005) fails if estimate + 3·SE < 0.94; an exact point fails below 0.94; the grid mean fails if mean + 3·SE < 0.95",
};

/** Type-I error at most nominal 0.05 (REQ-50, decision 0006). */
export const TYPE_I: Rule = {
  kind: "type-I",
  nominal: 0.05,
  clears: (p, s) => p <= 0.05 - 2 * s,
  fails: (p, s) => p - 3 * s > 0.05,
  text: "screen passes at ≤ 0.05 − 2·SE; a confirmed point (SE ≤ 0.0005) fails if estimate − 3·SE > 0.05; an exact point fails above 0.05",
};

/** Applies a rule to a grid and prints the table with the thresholds in effect. */
export function judge(points: readonly Point[], rule: Rule, title: string): Verdict {
  const failures: string[] = [];
  const screened = points.map((p): { point: Point; est: Estimate } => {
    if (p.exact !== undefined)
      return {
        point: p,
        est: { label: p.label, value: p.exact, se: 0, reps: "exact", stage: "exact" },
      };
    const value = estimate(p.run as (rng: Rng) => boolean, p.seed, REPS);
    return {
      point: p,
      est: { label: p.label, value, se: se(value, REPS), reps: REPS, stage: "screen" },
    };
  });
  const candidates = screened.filter(
    (s) => s.est.stage === "screen" && !rule.clears(s.est.value, s.est.se),
  );
  const capped = rule.kind === "coverage" && candidates.length > MAX_CANDIDATES;
  if (capped)
    failures.push(
      `${candidates.length} candidates at screening, more than ${MAX_CANDIDATES}: the interval misses the bar broadly`,
    );
  const estimates = screened.map((s) =>
    candidates.includes(s) && !capped ? confirm(s.point) : s.est,
  );
  for (const e of estimates) {
    if (e.stage === "exact" && (rule.kind === "coverage" ? e.value < 0.94 : e.value > 0.05))
      failures.push(`${e.label}: exact ${e.value.toFixed(4)}`);
    if (e.stage === "confirmed" && rule.fails(e.value, e.se))
      failures.push(`${e.label}: confirmed ${e.value.toFixed(4)} ± ${e.se.toFixed(4)}`);
  }
  if (rule.kind === "coverage") {
    const mean = estimates.reduce((a, e) => a + e.value, 0) / estimates.length;
    const meanSe = Math.sqrt(estimates.reduce((a, e) => a + e.se ** 2, 0)) / estimates.length;
    if (mean + 3 * meanSe < rule.nominal)
      failures.push(`grid mean ${mean.toFixed(4)} ± ${meanSe.toFixed(4)} below ${rule.nominal}`);
  }
  const values = estimates.map((e) => e.value);
  console.log(
    [
      `\n${title}: ${points.length} points, screening at ${REPS} repetitions, ${candidates.length} confirmed`,
      `rule: ${rule.text}`,
      ...estimates.map(
        (e) =>
          `  ${e.value.toFixed(4)} ${e.stage === "exact" ? "exact          " : `± ${e.se.toFixed(4)} ${e.stage === "confirmed" ? `(${e.reps})` : "      "}`}  ${e.label}`,
      ),
      `  minimum ${Math.min(...values).toFixed(4)}, maximum ${Math.max(...values).toFixed(4)}, mean ${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(4)}`,
      failures.length === 0 ? "  passes" : `  FAILS: ${failures.join("; ")}`,
    ].join("\n"),
  );
  return { title, failures, estimates };
}

/** A binomial draw by summing Bernoulli trials (small n only). */
export function binomial(rng: Rng, n: number, p: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) if (rng.uniform() < p) s++;
  return s;
}
