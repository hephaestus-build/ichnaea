// The planning explorer's numbers. Every statistic comes from `@hephaestus-build/ichnaea/stats`,
// the same functions a real comparison calls. This module only draws simulated trials and counts
// outcomes, so the page teaches the library's behaviour, not a copy of it.
import {
  compareCounts,
  createRng,
  fixedCasesFloor,
  type CaseCounts,
  type Rng,
} from "@hephaestus-build/ichnaea/stats";

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

/** A REGRESSION as the decision rule gives it: the test rejects and is validated for the design. */
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
    // At one trial per case, the regression test is validated only when the caller's checks of the
    // records passed: the pair order, the adjacency of the two trials and two clean A/A decisions
    // (decision 0020). Simulated trials have no records, so the explorer assumes they pass and the
    // page says so.
    ...(design.trials === 1 ? { oneTrial: { checksPassed: true, limitations: [] } } : {}),
  });
}

/** What the regression test's validated domain says about this design, in the library's words. */
export function regressionLimitations(design: Design): readonly string[] {
  return simulate(design, caseRates(design), 0, createRng(1)).regression.limitations;
}

/** Runs with no change between the arms, and how often each rule raises an alarm. */
export interface NoChangeRuns {
  readonly runs: number;
  /** Runs with a REGRESSION: the validated regression test rejects at α = 0.05. */
  readonly regressionAlarms: number;
  /** Runs in which the candidate's mean fell by the threshold or more. */
  readonly thresholdAlarms: number;
  /** Runs in which the lower bound clears the margin: a PASS once non-inferiority is validated. */
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

/** The share of runs that give REGRESSION for a decrease of the given size. */
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
