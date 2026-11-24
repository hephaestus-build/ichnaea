// The planning explorer's numbers. Every statistic comes from `@tumaet/ichnaea/stats`,
// for illustrative case-only comparisons. The runner's locked block tests are separate.
import {
  compareCounts,
  createRng,
  fixedCasesFloor,
  type CaseCounts,
  type Rng,
} from "@tumaet/ichnaea/stats";

/** A suite design, as the reader enters it. Rates and margins are fractions, not points. */
export interface Design {
  readonly cases: number;
  readonly trials: number;
  readonly margin: number;
  /** The share of cases that the base passes in every trial. */
  readonly alwaysPass: number;
  /** The pass rate of every other case. */
  readonly otherRate: number;
}

/** The fixed threshold that the page compares with: block when the mean falls by 3 points. */
export const THRESHOLD = 0.03;
export const ALPHA = 0.05;

/** The per-case pass rates of a design: the always-passing cases first, then the others. */
export function caseRates(design: Design): number[] {
  const always = Math.round(design.cases * design.alwaysPass);
  return Array.from({ length: design.cases }, (_, i) => (i < always ? 1 : design.otherRate));
}

function binomial(rng: Rng, trials: number, rate: number): number {
  let successes = 0;
  for (let i = 0; i < trials; i++) if (rng.uniform() < rate) successes++;
  return successes;
}

/** Whether the case-only test would reject on this design. */
const isRegression = (comparison: ReturnType<typeof compareCounts>): boolean =>
  comparison.regression.validated && comparison.regressionP < ALPHA;

/** One simulated comparison: the candidate's rate in each case is the base's minus `decrease`. */
function simulate(design: Design, rates: readonly number[], decrease: number, rng: Rng) {
  const cases: CaseCounts[] = rates.map((rate, i) => ({
    id: `case-${i + 1}`,
    base: { successes: binomial(rng, design.trials, rate), trials: design.trials },
    candidate: {
      successes: binomial(rng, design.trials, Math.max(0, rate - decrease)),
      trials: design.trials,
    },
  }));
  return compareCounts({
    alpha: ALPHA,
    cases,
    estimand: "fixed-cases",
    margin: design.margin,
    valueType: "binary",
    rng,
  });
}

/** What the regression test's validated domain says about this design, in the library's words. */
export function regressionLimitations(design: Design): readonly string[] {
  if (design.trials === 1)
    return ["The explorer needs at least two trials per case for its case-only test"];
  return simulate(design, caseRates(design), 0, createRng(1)).regression.limitations;
}

/** Runs with no change between the arms, and how often each rule raises an alarm. */
export interface NoChangeRuns {
  readonly runs: number;
  /** Runs in which the case-only test rejects at α = 0.05. */
  readonly regressionAlarms: number;
  /** Runs in which the candidate's mean fell by the threshold or more. */
  readonly thresholdAlarms: number;
  /** Runs in which the descriptive lower bound clears the margin. */
  readonly boundClearsMargin: number;
}

export function simulateNoChange(design: Design, runs: number, seed: number): NoChangeRuns {
  const rng = createRng(seed);
  const rates = caseRates(design);
  let regressionAlarms = 0;
  let thresholdAlarms = 0;
  let boundClearsMargin = 0;
  for (let run = 0; run < runs; run++) {
    const comparison = simulate(design, rates, 0, rng);
    if (isRegression(comparison)) regressionAlarms++;
    if (comparison.difference.estimate <= -THRESHOLD + 1e-12) thresholdAlarms++;
    if (comparison.difference.lower > -design.margin) boundClearsMargin++;
  }
  return { runs, regressionAlarms, thresholdAlarms, boundClearsMargin };
}

/** The share of runs in which the case-only test rejects for a given decrease. */
export function detectionRate(
  design: Design,
  decrease: number,
  runs: number,
  seed: number,
): number {
  const rng = createRng(seed);
  const rates = caseRates(design);
  let detected = 0;
  for (let run = 0; run < runs; run++)
    if (isRegression(simulate(design, rates, decrease, rng))) detected++;
  return detected / runs;
}

/**
 * The smallest decrease that the regression test detects in at least `power` of the runs, found
 * by bisection to within one point. Each step reuses the seed, so steps differ only in the
 * decrease. Returns undefined when even the largest possible decrease is not detected that often.
 */
export function detectableDecrease(
  design: Design,
  options: { power: number; runs: number; seed: number },
): number | undefined {
  let low = 0;
  let high = Math.max(...caseRates(design));
  if (detectionRate(design, high, options.runs, options.seed) < options.power) return undefined;
  while (high - low > 0.01) {
    const middle = (low + high) / 2;
    if (detectionRate(design, middle, options.runs, options.seed) >= options.power) high = middle;
    else low = middle;
  }
  return high;
}

/** The smallest margin that any run of this design can clear: every trial passes in both arms. */
export function bestCaseFloor(design: Design): number {
  return fixedCasesFloor(design.cases, design.trials, ALPHA);
}

/** Runs per simulated setting. The page states both numbers next to the results. */
export const NO_CHANGE_RUNS = 200;
export const DETECTION_RUNS = 100;

export interface PlannerRequest {
  readonly id: number;
  readonly design: Design;
  readonly seed: number;
}

export type PlannerResult =
  | {
      readonly id: number;
      readonly ok: true;
      readonly floor: number;
      readonly limitations: readonly string[];
      readonly noChange: NoChangeRuns;
      readonly detectable: number | undefined;
      readonly detectableRuns: number;
    }
  | { readonly id: number; readonly ok: false; readonly error: string };

/**
 * The worker's answer to one request. A failure is an answer too, so the page can say that the
 * calculation failed instead of waiting for a result that never comes.
 */
export function plan({ id, design, seed }: PlannerRequest): PlannerResult {
  try {
    return {
      id,
      ok: true,
      floor: bestCaseFloor(design),
      limitations: regressionLimitations(design),
      noChange: simulateNoChange(design, NO_CHANGE_RUNS, seed),
      detectable: detectableDecrease(design, { power: 0.8, runs: DETECTION_RUNS, seed: seed + 1 }),
      detectableRuns: DETECTION_RUNS,
    };
  } catch (error) {
    return { id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
