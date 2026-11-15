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

/** Binary outcomes of one case: one 0 or 1 per replicate and arm. Missing trials are left out. */
export interface BinaryCase {
  readonly id: string;
  readonly family?: string;
  readonly base: readonly (0 | 1)[];
  readonly candidate: readonly (0 | 1)[];
}

/** A paired comparison for one binary measure. */
export interface BinaryComparisonInput {
  readonly estimand: Estimand;
  readonly cases: readonly BinaryCase[];
  /** One-sided level of the non-inferiority and regression tests. */
  readonly alpha: number;
  /** Non-inferiority margin minus the safety margin: H0 is difference <= -margin. */
  readonly margin: number;
  readonly rng?: Rng;
  readonly score?: ScoreOptions;
}

/** The result of a paired comparison. */
export interface BinaryComparison {
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

const sum = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0);
const mean = (v: readonly number[]): number => sum(v) / v.length;

/**
 * Chooses and runs the paired method for a binary measure (the statistics table of the design):
 *
 * - `fixed-cases`: stratified score interval over cases, at least 2 replicates per case and arm;
 *   the regression test is the exact stratified conditional test.
 * - `sampled-cases`, one trial per case and arm, one case per family: Tango's score interval.
 * - `sampled-cases` otherwise: sign-flip randomisation on family-level differences.
 */
export function compareBinary(input: BinaryComparisonInput): BinaryComparison {
  const level = 1 - input.alpha;
  const paired = input.cases.filter((c) => c.base.length > 0 && c.candidate.length > 0);
  const droppedCases = input.cases.length - paired.length;
  if (paired.length === 0) throw new EstimandError("no case has trials in both arms");

  if (input.estimand === "fixed-cases") {
    const thin = paired.filter((c) => c.base.length < 2 || c.candidate.length < 2);
    if (thin.length > 0) {
      throw new EstimandError(
        `fixed-cases needs at least 2 replicates per case and arm; ${thin.length} case(s) have fewer`,
      );
    }
    const strata: Stratum[] = paired.map((c) => ({
      candidate: { successes: sum(c.candidate), trials: c.candidate.length },
      base: { successes: sum(c.base), trials: c.base.length },
    }));
    return {
      estimand: input.estimand,
      difference: scoreDifferenceInterval(strata, level, "lower", input.score),
      nonInferiorityP: scoreDifferenceTest(strata, -input.margin, "greater", input.score).p,
      regressionP: exactStratifiedTest(strata, "less").p,
      usedCases: paired.length,
      droppedCases,
      validated: true,
    };
  }

  const singleTrials = paired.every((c) => c.base.length === 1 && c.candidate.length === 1);
  const families = new Map<string, BinaryCase[]>();
  for (const c of paired)
    families.set(c.family ?? c.id, [...(families.get(c.family ?? c.id) ?? []), c]);
  if (singleTrials && families.size === paired.length) {
    const table: PairedTable = {
      both: paired.filter((c) => c.base[0] === 1 && c.candidate[0] === 1).length,
      candidateOnly: paired.filter((c) => c.base[0] === 0 && c.candidate[0] === 1).length,
      baseOnly: paired.filter((c) => c.base[0] === 1 && c.candidate[0] === 0).length,
      neither: paired.filter((c) => c.base[0] === 0 && c.candidate[0] === 0).length,
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
  const diffs = [...families.values()].map((group) =>
    mean(group.map((c) => mean(c.candidate) - mean(c.base))),
  );
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
