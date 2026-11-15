import { exactStratifiedTest } from "./exact-conditional.ts";
import type { Rng } from "./rng.ts";
import {
  scoreDifferenceInterval,
  scoreDifferenceTest,
  type ScoreOptions,
  type Stratum,
} from "./score-difference.ts";
import { signFlipInterval, signFlipTest } from "./randomisation.ts";
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
  return { successes: outcomes.reduce<number>((a, b) => a + b, 0), trials: outcomes.length, replicates: outcomes.length };
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

/**
 * Chooses and runs the paired method for a binary or proportion measure:
 *
 * - `fixed-cases`: stratified Miettinen–Nurminen score interval over cases, at least 2 replicates
 *   per case and arm; the regression test is the exact stratified conditional test.
 * - `sampled-cases`, one binary trial per case and arm, one case per family: Tango's score
 *   interval (skewness-corrected). Not yet validated to the simulation bar.
 * - `sampled-cases` otherwise: sign-flip randomisation on family-level differences of rates. Not
 *   yet validated to the simulation bar.
 */
export function compareCounts(input: ComparisonInput): Comparison {
  const level = 1 - input.alpha;
  for (const c of input.cases) {
    for (const [arm, counts] of [["base", c.base], ["candidate", c.candidate]] as const) {
      const { successes, trials, replicates } = counts;
      if (![successes, trials, replicates].every(Number.isInteger) || successes < 0 || successes > trials || replicates > trials || (replicates === 0) !== (trials === 0)) {
        throw new RangeError(`case '${c.id}' ${arm}: invalid counts ${successes}/${trials} over ${replicates} replicates`);
      }
    }
  }
  const paired = input.cases.filter((c) => c.base.replicates > 0 && c.candidate.replicates > 0);
  const droppedCases = input.cases.length - paired.length;
  if (paired.length === 0) throw new EstimandError("no case has trials in both arms");

  if (input.estimand === "fixed-cases") {
    const thin = paired.filter((c) => c.base.replicates < 2 || c.candidate.replicates < 2);
    if (thin.length > 0) {
      throw new EstimandError(`fixed-cases needs at least 2 replicates per case and arm; ${thin.length} case(s) have fewer`);
    }
    const strata: Stratum[] = paired.map((c) => ({
      candidate: { successes: c.candidate.successes, trials: c.candidate.trials },
      base: { successes: c.base.successes, trials: c.base.trials },
    }));
    return {
      estimand: input.estimand,
      difference: scoreDifferenceInterval(strata, level, "lower", input.score),
      nonInferiorityP: scoreDifferenceTest(strata, -input.margin, "greater", input.score).p,
      regressionP: exactStratifiedTest(strata, "less").p,
      usedCases: paired.length,
      droppedCases,
      // Several items inside one trial (a proportion) are treated as independent trials. Items
      // of one output are correlated, so the interval may be too narrow: not yet validated.
      validated: paired.every((c) => c.base.trials === c.base.replicates && c.candidate.trials === c.candidate.replicates),
    };
  }

  const singleTrials = paired.every((c) => c.base.trials === 1 && c.candidate.trials === 1);
  const families = new Map<string, CaseCounts[]>();
  for (const c of paired) families.set(c.family ?? c.id, [...(families.get(c.family ?? c.id) ?? []), c]);
  if (singleTrials && families.size === paired.length) {
    const table: PairedTable = {
      both: paired.filter((c) => c.base.successes === 1 && c.candidate.successes === 1).length,
      candidateOnly: paired.filter((c) => c.base.successes === 0 && c.candidate.successes === 1).length,
      baseOnly: paired.filter((c) => c.base.successes === 1 && c.candidate.successes === 0).length,
      neither: paired.filter((c) => c.base.successes === 0 && c.candidate.successes === 0).length,
    };
    return {
      estimand: input.estimand,
      difference: tangoInterval(table, level, "lower", true),
      nonInferiorityP: tangoTest(table, -input.margin, "greater", true).p,
      regressionP: tangoTest(table, 0, "less", true).p,
      usedCases: paired.length,
      droppedCases,
      validated: false,
    };
  }
  const diffs = [...families.values()].map((group) => mean(group.map((c) => rate(c.candidate) - rate(c.base))));
  const options = input.rng ? { rng: input.rng } : {};
  return {
    estimand: input.estimand,
    difference: signFlipInterval(diffs, level, "lower", options),
    nonInferiorityP: signFlipTest(diffs, -input.margin, "greater", options).p,
    regressionP: signFlipTest(diffs, 0, "less", options).p,
    usedCases: paired.length,
    droppedCases,
    validated: false,
  };
}
