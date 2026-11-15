import { exactStratifiedTest } from "./exact-conditional.ts";
import type { Rng } from "./rng.ts";
import {
  scoreDifferenceInterval,
  scoreDifferenceTest,
  type ScoreOptions,
  type Stratum,
} from "./score-difference.ts";
import { signFlipTest, withinCasePermutationTest } from "./randomisation.ts";
import { tangoInterval, tangoTest, type PairedTable } from "./tango.ts";
import type { Interval } from "./types.ts";

/** The question an estimate answers. */
export type Estimand = "fixed-cases" | "sampled-cases";

/** One arm's outcomes on one case: successes of trials over its replicates. */
export interface ArmCounts {
  readonly successes: number;
  readonly trials: number;
  /** Trials (runs) with a value, at least 1. A binary measure has trials === replicates. */
  readonly replicates: number;
}

/** Counts of one case under both arms. An arm without replicates is missing. */
export interface CaseCounts {
  readonly id: string;
  readonly family?: string;
  readonly base: ArmCounts;
  readonly candidate: ArmCounts;
}

/** Counts for a binary measure from its 0 and 1 outcomes per replicate. */
export function countsFromOutcomes(outcomes: readonly (0 | 1)[]): ArmCounts {
  return {
    successes: outcomes.reduce<number>((a, b) => a + b, 0),
    trials: outcomes.length,
    replicates: outcomes.length,
  };
}

/** A paired comparison for one binary or proportion measure. */
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
  readonly usedCases: number;
  readonly droppedCases: number;
  /**
   * Whether the method has passed the simulation bar (VALIDATION.md). A decision built on an
   * unvalidated method states it as a limitation.
   */
  readonly validated: boolean;
}

/** Thrown when the data cannot support the estimand. The decision then runs estimate-only. */
export class EstimandError extends Error {
  override readonly name = "EstimandError";
}

const mean = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
const rate = (a: ArmCounts): number => a.successes / a.trials;

/** Below this many items, sampled-cases uses randomisation, never an asymptotic score method (REQ-50). */
export const SCORE_METHOD_MIN_ITEMS = 300;

/**
 * Chooses and runs the paired method for a binary or proportion measure.
 *
 * - `fixed-cases`: the stratified Miettinen–Nurminen score interval and test over cases with equal
 *   case weights, so the estimate is the mean of per-case differences. A case with fewer than 2
 *   replicates in either arm leaves the analysis and is counted. The regression test is the exact
 *   stratified conditional test when every case has the same replicate counts and binary values,
 *   and a within-case permutation test otherwise.
 * - `sampled-cases`, one binary trial per case and arm, one case per family, at least 300 cases:
 *   Tango's score interval, skewness-corrected.
 * - `sampled-cases` otherwise: the sign-flip randomisation test of no difference on family-level
 *   differences, for the regression test only. No validated non-inferiority method exists for
 *   this path yet, so non-inferiority is never shown (the bound is −1).
 *
 * `validated` is true only inside the domain the simulation studies cover (VALIDATION.md).
 */
export function compareCounts(input: ComparisonInput): Comparison {
  if (!(input.margin >= 0 && input.margin < 1))
    throw new RangeError(`margin must be in [0, 1), got ${input.margin}`);
  if (!(input.alpha > 0 && input.alpha < 0.5))
    throw new RangeError(`alpha must be in (0, 0.5), got ${input.alpha}`);
  const level = 1 - input.alpha;
  for (const c of input.cases) {
    for (const [arm, counts] of [
      ["base", c.base],
      ["candidate", c.candidate],
    ] as const) {
      const { successes, trials, replicates } = counts;
      if (
        ![successes, trials, replicates].every(Number.isInteger) ||
        successes < 0 ||
        successes > trials ||
        replicates > trials ||
        (replicates === 0) !== (trials === 0)
      ) {
        throw new RangeError(
          `case '${c.id}' ${arm}: invalid counts ${successes}/${trials} over ${replicates} replicates`,
        );
      }
    }
  }
  const ids = new Set(input.cases.map((c) => c.id));
  if (ids.size !== input.cases.length) throw new RangeError("case IDs must be unique");
  // A canonical case order, so the result never depends on the order of the input.
  const ordered = input.cases.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (input.estimand === "fixed-cases") {
    const used = ordered.filter((c) => c.base.replicates >= 2 && c.candidate.replicates >= 2);
    const droppedCases = ordered.length - used.length;
    if (used.length === 0)
      throw new EstimandError(
        "fixed-cases needs at least 2 replicates per case and arm, and no case has them",
      );
    const strata: Stratum[] = used.map((c) => ({
      candidate: { successes: c.candidate.successes, trials: c.candidate.trials },
      base: { successes: c.base.successes, trials: c.base.trials },
    }));
    const options: ScoreOptions = { ...input.score, weights: "equal" };
    const binary = used.every(
      (c) => c.base.trials === c.base.replicates && c.candidate.trials === c.candidate.replicates,
    );
    const counts = new Set(used.flatMap((c) => [c.base.trials, c.candidate.trials]));
    const balanced = binary && counts.size === 1;
    let regressionP: number;
    if (balanced) {
      regressionP = exactStratifiedTest(strata, "less").p;
    } else {
      if (!input.rng)
        throw new EstimandError(
          "unequal replicate counts need a seeded generator for the within-case permutation test",
        );
      regressionP = withinCasePermutationTest(strata, input.rng).p;
    }
    return {
      estimand: input.estimand,
      difference: {
        ...scoreDifferenceInterval(strata, level, "lower", options),
        estimand: "fixed-cases",
      },
      nonInferiorityP: scoreDifferenceTest(strata, -input.margin, "greater", options).p,
      regressionP,
      usedCases: used.length,
      droppedCases,
      // The studied domain: binary values, the same replicate count for every case, 3 or more cases.
      validated: balanced && used.length >= 3,
    };
  }

  const paired = ordered.filter((c) => c.base.replicates > 0 && c.candidate.replicates > 0);
  const droppedCases = ordered.length - paired.length;
  if (paired.length === 0) throw new EstimandError("no case has trials in both arms");
  const singleTrials = paired.every((c) => c.base.trials === 1 && c.candidate.trials === 1);
  const families = new Map<string, CaseCounts[]>();
  for (const c of paired)
    families.set(c.family ?? c.id, [...(families.get(c.family ?? c.id) ?? []), c]);
  if (singleTrials && families.size === paired.length && paired.length >= SCORE_METHOD_MIN_ITEMS) {
    const table: PairedTable = {
      both: paired.filter((c) => c.base.successes === 1 && c.candidate.successes === 1).length,
      candidateOnly: paired.filter((c) => c.base.successes === 0 && c.candidate.successes === 1)
        .length,
      baseOnly: paired.filter((c) => c.base.successes === 1 && c.candidate.successes === 0).length,
      neither: paired.filter((c) => c.base.successes === 0 && c.candidate.successes === 0).length,
    };
    return {
      estimand: input.estimand,
      difference: { ...tangoInterval(table, level, "lower", true), estimand: "sampled-cases" },
      nonInferiorityP: tangoTest(table, -input.margin, "greater", true).p,
      regressionP: tangoTest(table, 0, "less", true).p,
      usedCases: paired.length,
      droppedCases,
      validated: false,
    };
  }
  // Family-level differences in a canonical order (families sorted by name).
  const names = [...families.keys()].toSorted();
  const diffs = names.map((name) =>
    mean((families.get(name) as CaseCounts[]).map((c) => rate(c.candidate) - rate(c.base))),
  );
  const options = input.rng ? { rng: input.rng } : {};
  const estimate = mean(diffs);
  return {
    estimand: input.estimand,
    difference: {
      estimate,
      lower: -1,
      upper: 1,
      level,
      sided: "lower",
      method: "sign-flip (regression test only; no validated non-inferiority method)",
      estimand: "sampled-cases",
    },
    nonInferiorityP: 1,
    regressionP: signFlipTest(diffs, 0, "less", options).p,
    usedCases: paired.length,
    droppedCases,
    validated: false,
  };
}
