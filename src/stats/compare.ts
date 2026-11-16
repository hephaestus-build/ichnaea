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
  /** The case's ID, unique in a comparison. */
  readonly id: string;
  /** The case's family, a group of related cases; absent means the case is a family of its own. */
  readonly family?: string;
  /** The case's counts under the base arm. */
  readonly base: ArmCounts;
  /** The case's counts under the candidate arm. */
  readonly candidate: ArmCounts;
}

/** Counts from the 0 and 1 outcomes of an arm's completed trials. */
export function countsFromOutcomes(outcomes: readonly (0 | 1)[]): ArmCounts {
  return { successes: outcomes.reduce<number>((a, b) => a + b, 0), trials: outcomes.length };
}

/**
 * A measure's value type. Only `binary`, one 0 or 1 per trial, has a validated method. A proportion
 * is several items in one output: its items are never independent trials, so it cannot be passed
 * as counts.
 */
export type ValueType = "binary" | "proportion" | "score" | "ordinal";

/** A paired comparison for one binary measure. */
export interface ComparisonInput {
  /** The question that the comparison answers; it selects the method. */
  readonly estimand: Estimand;
  /** The measure's value type; anything but `binary` is refused (EstimandError). */
  readonly valueType: ValueType;
  /** The counts of each case; case IDs must be unique. */
  readonly cases: readonly CaseCounts[];
  /** One-sided level of the non-inferiority and regression tests. */
  readonly alpha: number;
  /** Non-inferiority margin minus the safety margin: H0 is difference <= -margin. */
  readonly margin: number;
  /**
   * The seeded generator for the within-case permutation test; required when trial counts differ
   * between cells.
   */
  readonly rng?: Rng;
  /**
   * The caller's checks of the records behind a comparison at one trial per case and arm: the
   * order within each pair, the adjacency of the arms in time and the A/A runs (VALIDATION.md, "One
   * trial per case"). The statistics cannot see the records, so the regression result at one trial
   * per case is validated only when the caller states that these checks passed. Without it, that
   * result is not validated (`ONE_TRIAL_NEEDS_CHECKS`). It changes nothing at two or more trials.
   */
  readonly oneTrial?: OneTrialChecks;
}

/** What the caller's checks of the records found, for a comparison at one trial per case. */
export interface OneTrialChecks {
  /** Whether every check passed. */
  readonly checksPassed: boolean;
  /** Why a check did not pass. Each one becomes a limitation of the regression result. */
  readonly limitations: readonly string[];
}

/** The result of a paired comparison. */
export interface Comparison {
  /** The question that the comparison answers. */
  readonly estimand: Estimand;
  /**
   * One-sided lower interval matching the non-inferiority test. A lower bound above 0, a claim that
   * the candidate is better, is descriptive: it is the test at a margin of 0, below the validated
   * margin floor, so no result vouches for it (decision 0009).
   */
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
   * Whether the regression test's result lies inside the domain where its type-I error is shown
   * (VALIDATION.md). It does not depend on the margin, and it never vouches for the interval.
   */
  readonly regression: Validity;
  /**
   * Whether the non-inferiority result, the interval against the margin, lies inside the domain
   * where its coverage is shown: the regression domain, plus an established margin floor and an
   * effective margin from that floor up to VALIDATED_MARGIN_CEILING. No verdict may rest on a
   * result that is not validated (decision 0008).
   */
  readonly nonInferiority: Validity;
}

/** Whether one result of a comparison is validated, and why not. */
export interface Validity {
  /** Whether the result lies inside its validated domain. */
  readonly validated: boolean;
  /** Why the result is not validated. Empty when it is. */
  readonly limitations: readonly string[];
}

const validity = (limitations: readonly string[]): Validity => ({
  validated: limitations.length === 0,
  limitations,
});

/** The regression limitation at one trial per case and arm when the caller states no checks. */
export const ONE_TRIAL_NEEDS_CHECKS =
  "one trial per case needs decide's checks of the trial order, the timestamps and the A/A runs";

/**
 * The non-inferiority limitation at one trial per case and arm. Most pairs agree there, the
 * mechanism that sets the margin floor, so the interval needs its own floor sweep first.
 */
export const NON_INFERIORITY_AT_ONE_TRIAL =
  "non-inferiority is not validated at one trial per case";

/** Thrown when the data cannot support the estimand. The decision then runs estimate-only. */
export class EstimandError extends Error {
  /** The error's name, for `instanceof`-free checks. */
  override readonly name = "EstimandError";
}

/** The fixed-cases domain the simulation studies cover (VALIDATION.md, decision 0009). */
export const VALIDATED_FIXED_CASES: {
  readonly minCases: number;
  readonly maxTrials: number;
  readonly minShareWithTwoTrials: number;
} = {
  /** Fewest cases. At 3 and 4 cases with 2 trials, exact coverage dips to 0.9385. */
  minCases: 5,
  /**
   * Most completed trials per case and arm. Suites run 2 or 3, and the search for heterogeneous
   * effects covers 2, 3 and mixed counts, so more than 3 is outside the validated domain.
   */
  maxTrials: 3,
  /**
   * Smallest share of case-arm cells with at least 2 completed trials (missingness studied). It
   * does not apply at exactly one trial in every cell, which has its own conditions (`oneTrial`).
   */
  minShareWithTwoTrials: 0.9,
};

/**
 * The fixed-cases case selection and lower bound, as `compareCounts` computes them: every case with
 * at least one completed trial in each arm, equal case weights, the stratified Miettinen–Nurminen
 * score interval with the N/(N−1) factor. The simulation studies call this function, so they test
 * the decision path itself. It takes no score options: every other variant is outside the validated
 * domain (a variant without the factor undercovers), so a caller cannot select one here.
 */
export function fixedCasesInterval(
  cases: readonly CaseCounts[],
  level: number,
): { interval: Interval; strata: Stratum[]; options: ScoreOptions } {
  const strata: Stratum[] = cases
    .filter((c) => c.base.trials > 0 && c.candidate.trials > 0)
    .map((c) => ({ candidate: c.candidate, base: c.base }));
  const options: ScoreOptions = { weights: "equal" };
  return {
    interval: {
      ...scoreDifferenceInterval(strata, level, "lower", options),
      estimand: "fixed-cases",
    },
    strata,
    options,
  };
}

/**
 * Fewest cases for a sampled-cases method. Below it: estimate-only. The method also needs one case
 * per family, so it needs as many families as cases.
 */
export const SAMPLED_CASES_MIN_CASES = 300;

/**
 * Smallest effective non-inferiority margin for the fixed-cases interval: the declared margin minus
 * any safety margin, which is the `margin` that `compareCounts` takes. A placeholder: under
 * heterogeneous effects the lower bound can undercover at small margins, and the floor is not yet
 * established (VALIDATION.md, "The validated domain"). A margin of 0 is not a non-inferiority test.
 */
export const VALIDATED_MARGIN_FLOOR = 0.05;

/**
 * Whether the margin floor is established. Until a reviewed search sets it, every non-inferiority
 * result is not validated, whatever its margin (VALIDATION.md, "The validated domain").
 */
export const VALIDATED_MARGIN_FLOOR_SET = false;

/** The reason every non-inferiority result gives while the floor is not set. */
export const MARGIN_FLOOR_NOT_SET = "the validated margin floor is not set yet";

/**
 * Largest effective non-inferiority margin for the fixed-cases interval. A margin above 30 points
 * says nothing useful about a drop.
 */
export const VALIDATED_MARGIN_CEILING = 0.3;

/** The regression limitations at one trial per case and arm, from the caller's checks. */
function oneTrialLimitations(checks: OneTrialChecks | undefined): readonly string[] {
  if (checks === undefined) return [ONE_TRIAL_NEEDS_CHECKS];
  if (checks.limitations.length > 0) return checks.limitations;
  return checks.checksPassed ? [] : ["the caller's checks of one trial per case did not pass"];
}

/**
 * Chooses and runs the paired method for a binary measure. Proportion, score and ordinal measures
 * have no validated method yet (decision 0008) and never reach it.
 *
 * - `fixed-cases`: every completed trial counts. A case with at least one completed trial in each
 *   arm enters the stratified Miettinen–Nurminen score interval and test with equal case weight, so
 *   the estimate is the mean of per-case differences. A case with no completed trial in an arm is
 *   excluded and counted. The regression test is the exact stratified conditional test when every
 *   case and arm has the same number of trials, and a within-case permutation test otherwise. At one
 *   trial per case and arm, the regression result is validated only with the caller's `oneTrial`
 *   checks passed, and the non-inferiority result never is.
 * - `sampled-cases`, one trial per case and arm, one case per family, at least 300 cases: Tango's
 *   skewness-corrected score interval. It is experimental, so never validated.
 * - `sampled-cases` otherwise: no method; an EstimandError makes the measure estimate-only.
 */
export function compareCounts(input: ComparisonInput): Comparison {
  if (input.valueType !== "binary")
    throw new EstimandError(
      `the value type "${input.valueType}" has no validated method yet, so it is estimate-only; only binary outcomes, one per trial, can be compared`,
    );
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
    const { interval, strata, options } = fixedCasesInterval(used, level);
    const cells = used.flatMap((c) => [c.base.trials, c.candidate.trials]);
    const balanced = new Set(cells).size === 1;
    let regressionTest: { p: number; method: string };
    if (balanced) {
      regressionTest = exactStratifiedTest(strata, "less");
    } else {
      if (!input.rng)
        throw new EstimandError(
          "unequal trial counts need a seeded generator for the within-case permutation test",
        );
      regressionTest = withinCasePermutationTest(strata, input.rng);
    }
    const domain = VALIDATED_FIXED_CASES;
    // One trial in every cell of at least 5 cases: the domain of the binary one-trial study. Its
    // conditions are checks of the records, which the caller states (VALIDATION.md).
    const oneTrial = used.length >= domain.minCases && cells.every((n) => n === 1);
    const checks = oneTrial ? input.oneTrial : undefined;
    const domainLimitations = [
      ...(used.length < domain.minCases
        ? [`${used.length} case(s); the validated domain starts at ${domain.minCases}`]
        : []),
      // At one trial per case, the caller's checks count a case without its pair against coverage,
      // so its exclusion is no limitation once the caller states them.
      ...(excludedCases > 0 && checks === undefined
        ? [`${excludedCases} case(s) have no completed trial in an arm and are excluded`]
        : []),
      ...(Math.max(...cells) > domain.maxTrials
        ? [`more than ${domain.maxTrials} trials per case and arm is outside the studied grid`]
        : []),
      ...(oneTrial
        ? oneTrialLimitations(checks)
        : cells.filter((n) => n >= 2).length < domain.minShareWithTwoTrials * cells.length
          ? [
              `fewer than ${domain.minShareWithTwoTrials * 100}% of case-arm cells have 2 or more completed trials`,
            ]
          : []),
    ];
    const marginLimitations = [
      ...(VALIDATED_MARGIN_FLOOR_SET ? [] : [MARGIN_FLOOR_NOT_SET]),
      ...(input.margin < VALIDATED_MARGIN_FLOOR
        ? [`margin ${input.margin} is below the validated margin floor ${VALIDATED_MARGIN_FLOOR}`]
        : []),
      ...(input.margin > VALIDATED_MARGIN_CEILING
        ? [
            `margin ${input.margin} is above the validated margin ceiling ${VALIDATED_MARGIN_CEILING}`,
          ]
        : []),
    ];
    return {
      estimand: input.estimand,
      difference: interval,
      nonInferiorityP: scoreDifferenceTest(strata, -input.margin, "greater", options).p,
      regressionP: regressionTest.p,
      regressionMethod: regressionTest.method,
      usedCases: used.length,
      excludedCases,
      regression: validity(domainLimitations),
      nonInferiority: validity([
        ...domainLimitations,
        ...marginLimitations,
        ...(oneTrial ? [NON_INFERIORITY_AT_ONE_TRIAL] : []),
      ]),
    };
  }

  const singleTrials = used.every((c) => c.base.trials === 1 && c.candidate.trials === 1);
  const families = new Set(used.map((c) => c.family ?? c.id));
  if (!singleTrials || families.size !== used.length || used.length < SAMPLED_CASES_MIN_CASES) {
    throw new EstimandError(
      `sampled-cases needs at least ${SAMPLED_CASES_MIN_CASES} cases, one trial per case and arm and one case per family; this comparison has ${used.length} case(s) in ${families.size} famil${families.size === 1 ? "y" : "ies"}, so it is estimate-only`,
    );
  }
  const table: PairedTable = {
    both: used.filter((c) => c.base.successes === 1 && c.candidate.successes === 1).length,
    candidateOnly: used.filter((c) => c.base.successes === 0 && c.candidate.successes === 1).length,
    baseOnly: used.filter((c) => c.base.successes === 1 && c.candidate.successes === 0).length,
    neither: used.filter((c) => c.base.successes === 0 && c.candidate.successes === 0).length,
  };
  const regressionTest = tangoTest(table, 0, "less", true);
  const experimental = ["Tango's skewness-corrected interval is experimental (VALIDATION.md)"];
  return {
    estimand: input.estimand,
    difference: { ...tangoInterval(table, level, "lower", true), estimand: "sampled-cases" },
    nonInferiorityP: tangoTest(table, -input.margin, "greater", true).p,
    regressionP: regressionTest.p,
    regressionMethod: regressionTest.method,
    usedCases: used.length,
    excludedCases,
    regression: validity(experimental),
    nonInferiority: validity(experimental),
  };
}
