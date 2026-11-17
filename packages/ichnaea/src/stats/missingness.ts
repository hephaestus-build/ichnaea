import { exactStratifiedTest } from "./exact-conditional.ts";

/** One arm's missing trials of one case, of the trials the plan asked for. */
export interface ArmMissing {
  /** The planned trials with no value. */
  readonly missing: number;
  /** The trials the plan asked for. */
  readonly planned: number;
}

/**
 * The exact test of a difference in missingness between the arms: the stratified
 * conditional test over cases, with the missing trials as the counted outcome, two-sided as twice
 * the smaller one-sided p-value, capped at 1. It flags; it never decides a comparison.
 */
export function missingDifferenceTest(
  cases: readonly { readonly base: ArmMissing; readonly candidate: ArmMissing }[],
): {
  readonly p: number;
  readonly method: "exact-stratified-conditional-two-sided";
  readonly missing: { readonly base: number; readonly candidate: number };
} {
  const strata = cases.map(({ base, candidate }) => {
    for (const arm of [base, candidate])
      if (
        !(Number.isInteger(arm.missing) && Number.isInteger(arm.planned)) ||
        arm.missing < 0 ||
        arm.missing > arm.planned
      )
        throw new RangeError(`invalid missing count ${arm.missing} of ${arm.planned}`);
    return {
      base: { successes: base.missing, trials: base.planned },
      candidate: { successes: candidate.missing, trials: candidate.planned },
    };
  });
  const less = exactStratifiedTest(strata, "less").p;
  const greater = exactStratifiedTest(strata, "greater").p;
  return {
    p: Math.min(1, 2 * Math.min(less, greater)),
    method: "exact-stratified-conditional-two-sided",
    missing: {
      base: cases.reduce((a, c) => a + c.base.missing, 0),
      candidate: cases.reduce((a, c) => a + c.candidate.missing, 0),
    },
  };
}
