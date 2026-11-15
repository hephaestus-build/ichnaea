import { exactStratifiedTest } from "./exact-conditional.ts";
import type { Rng } from "./rng.ts";
import {
  scoreDifferenceInterval,
  scoreDifferenceTest,
  type ScoreOptions,
  type Stratum,
} from "./score-difference.ts";
import { withinCasePermutationTest } from "./randomisation.ts";
import { tangoInterval, tangoTest, type PairedTable } from "./tango.ts";
import { assertCount, type Count, type Interval } from "./types.ts";

/** The question an estimate answers. */
export type Estimand = "fixed-cases" | "sampled-cases";

/**
 * One arm's binary outcomes on one case: the completed trials that passed, of all completed trials.
 * A trial with no value (an infrastructure failure, a trial not run) is not a trial here.
 */
export type ArmCounts = Count;

/** Counts of one case under both arms. An arm without trials is missing. */
export interface CaseCounts {
  readonly id: string;
  readonly family?: string;
  readonly base: ArmCounts;
  readonly candidate: ArmCounts;
}

/** Counts from the 0 and 1 outcomes of an arm's completed trials. */
export function countsFromOutcomes(outcomes: readonly (0 | 1)[]): ArmCounts {
  return { successes: outcomes.reduce<number>((a, b) => a + b, 0), trials: outcomes.length };
}

/** A paired comparison for one binary measure. */
export interface ComparisonInput {
  readonly estimand: Estimand;
  readonly cases: readonly CaseCounts[];
  /** One-sided level of the non-inferiority and regression tests. */
  readonly alpha: number;
  /** Non-inferiority margin minus the safety margin: H0 is difference <= -margin. */
  readonly margin: number;
  readonly rng?: Rng;
  readonly score?: ScoreOptions;
}

/** The result of a paired comparison. */
export interface Comparison {
  readonly estimand: Estimand;
  /** One-sided lower interval matching the non-inferiority test. */
  readonly difference: Interval;
  /** p-value of H0: difference <= -margin. */
  readonly nonInferiorityP: number;
  /** p-value of H0: difference >= 0 (unadjusted). */
  readonly regressionP: number;
  /** The stable name of the regression test's method, recorded in decisions. */
  readonly regressionMethod: string;
  /** Cases with at least one completed trial in each arm: all of them enter the analysis. */
  readonly usedCases: number;
  /** Cases with no completed trial in an arm. They are missing and count against coverage. */
  readonly excludedCases: number;
  /**
   * Whether the call lies inside the domain the simulation studies validate (VALIDATION.md). No
   * verdict may rest on a result that is not validated (DN-8).
   */
  readonly validated: boolean;
  /** Why the result is not validated. Empty when it is. */
  readonly limitations: readonly string[];
}

/** Thrown when the data cannot support the estimand. The decision then runs estimate-only. */
export class EstimandError extends Error {
  override readonly name = "EstimandError";
}

/** The fixed-cases domain the simulation studies cover (VALIDATION.md, DC-6). */
export const VALIDATED_FIXED_CASES: {
  readonly minCases: number;
  readonly maxTrials: number;
  readonly minShareWithTwoTrials: number;
} = {
  /** Fewest cases. At 3 and 4 cases with 2 trials, exact coverage dips to 0.9385. */
  minCases: 5,
  /** Most completed trials per case and arm that the grid covers. */
  maxTrials: 5,
  /** Smallest share of case-arm cells with at least 2 completed trials (missingness studied). */
  minShareWithTwoTrials: 0.9,
};

/**
 * The fixed-cases case selection and lower bound, as `compareCounts` computes them: every case with
 * at least one completed trial in each arm, equal case weights, the stratified Miettinen–Nurminen
 * score interval with the N/(N−1) factor. The simulation studies call this function, so they test
 * the decision path itself.
 */
export function fixedCasesInterval(
  cases: readonly CaseCounts[],
  level: number,
  score: ScoreOptions = {},
): { interval: Interval; strata: Stratum[]; options: ScoreOptions } {
  const strata: Stratum[] = cases
    .filter((c) => c.base.trials > 0 && c.candidate.trials > 0)
    .map((c) => ({ candidate: c.candidate, base: c.base }));
  const options: ScoreOptions = { ...score, weights: "equal" };
  return {
    interval: {
      ...scoreDifferenceInterval(strata, level, "lower", options),
      estimand: "fixed-cases",
    },
    strata,
    options,
  };
}

/** Fewest cases, and families, for a sampled-cases method (DC-6). Below it: estimate-only. */
export const SAMPLED_CASES_MIN_CASES = 300;
/** Fewest families for a sampled-cases method (DC-6). */
export const SAMPLED_CASES_MIN_FAMILIES = 30;

/**
 * Chooses and runs the paired method for a binary measure. Proportion, score and ordinal measures
 * have no validated method yet (DN-8) and never reach it.
 *
 * - `fixed-cases`: every completed trial counts. A case with at least one completed trial in each
 *   arm enters the stratified Miettinen–Nurminen score interval and test with equal case weight, so
 *   the estimate is the mean of per-case differences. A case with no completed trial in an arm is
 *   excluded and counted. The regression test is the exact stratified conditional test when every
 *   case and arm has the same number of trials, and a within-case permutation test otherwise.
 * - `sampled-cases`, one trial per case and arm, one case per family, at least 300 cases: Tango's
 *   skewness-corrected score interval. It is experimental, so never validated.
 * - `sampled-cases` otherwise: no method; an EstimandError makes the measure estimate-only.
 */
export function compareCounts(input: ComparisonInput): Comparison {
  if (!(input.margin >= 0 && input.margin < 1))
    throw new RangeError(`margin must be in [0, 1), got ${input.margin}`);
  if (!(input.alpha > 0 && input.alpha < 0.5))
    throw new RangeError(`alpha must be in (0, 0.5), got ${input.alpha}`);
  const level = 1 - input.alpha;
  for (const c of input.cases) {
    assertCount(c.base, `case '${c.id}' base`);
    assertCount(c.candidate, `case '${c.id}' candidate`);
  }
  const ids = new Set(input.cases.map((c) => c.id));
  if (ids.size !== input.cases.length) throw new RangeError("case IDs must be unique");
  // A canonical case order, so the result never depends on the order of the input.
  const ordered = input.cases.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const used = ordered.filter((c) => c.base.trials > 0 && c.candidate.trials > 0);
  const excludedCases = ordered.length - used.length;
  if (used.length === 0) throw new EstimandError("no case has a completed trial in both arms");

  if (input.estimand === "fixed-cases") {
    const { interval, strata, options } = fixedCasesInterval(used, level, input.score);
    const cells = used.flatMap((c) => [c.base.trials, c.candidate.trials]);
    const balanced = new Set(cells).size === 1;
    let regression: { p: number; method: string };
    if (balanced) {
      regression = exactStratifiedTest(strata, "less");
    } else {
      if (!input.rng)
        throw new EstimandError(
          "unequal trial counts need a seeded generator for the within-case permutation test",
        );
      regression = withinCasePermutationTest(strata, input.rng);
    }
    const domain = VALIDATED_FIXED_CASES;
    const limitations = [
      ...(used.length < domain.minCases
        ? [`${used.length} case(s); the validated domain starts at ${domain.minCases}`]
        : []),
      ...(excludedCases > 0
        ? [`${excludedCases} case(s) have no completed trial in an arm and are excluded`]
        : []),
      ...(Math.max(...cells) > domain.maxTrials
        ? [`more than ${domain.maxTrials} trials per case and arm is outside the studied grid`]
        : []),
      ...(cells.filter((n) => n >= 2).length < domain.minShareWithTwoTrials * cells.length
        ? [
            `fewer than ${domain.minShareWithTwoTrials * 100}% of case-arm cells have 2 or more completed trials`,
          ]
        : []),
    ];
    return {
      estimand: input.estimand,
      difference: interval,
      nonInferiorityP: scoreDifferenceTest(strata, -input.margin, "greater", options).p,
      regressionP: regression.p,
      regressionMethod: regression.method,
      usedCases: used.length,
      excludedCases,
      validated: limitations.length === 0,
      limitations,
    };
  }

  const singleTrials = used.every((c) => c.base.trials === 1 && c.candidate.trials === 1);
  const families = new Set(used.map((c) => c.family ?? c.id));
  if (
    !singleTrials ||
    families.size !== used.length ||
    used.length < SAMPLED_CASES_MIN_CASES ||
    families.size < SAMPLED_CASES_MIN_FAMILIES
  ) {
    throw new EstimandError(
      `sampled-cases needs at least ${SAMPLED_CASES_MIN_CASES} cases and ${SAMPLED_CASES_MIN_FAMILIES} families, one trial per case and arm and one case per family; this comparison has ${used.length} case(s) in ${families.size} famil${families.size === 1 ? "y" : "ies"}, so it is estimate-only`,
    );
  }
  const table: PairedTable = {
    both: used.filter((c) => c.base.successes === 1 && c.candidate.successes === 1).length,
    candidateOnly: used.filter((c) => c.base.successes === 0 && c.candidate.successes === 1).length,
    baseOnly: used.filter((c) => c.base.successes === 1 && c.candidate.successes === 0).length,
    neither: used.filter((c) => c.base.successes === 0 && c.candidate.successes === 0).length,
  };
  const regression = tangoTest(table, 0, "less", true);
  return {
    estimand: input.estimand,
    difference: { ...tangoInterval(table, level, "lower", true), estimand: "sampled-cases" },
    nonInferiorityP: tangoTest(table, -input.margin, "greater", true).p,
    regressionP: regression.p,
    regressionMethod: regression.method,
    usedCases: used.length,
    excludedCases,
    validated: false,
    limitations: ["Tango's skewness-corrected interval is experimental (VALIDATION.md)"],
  };
}
