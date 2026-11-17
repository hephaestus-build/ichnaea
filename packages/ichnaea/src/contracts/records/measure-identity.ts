import * as z from "zod";

import { none } from "../data-class.ts";
import { Digest } from "../primitives.ts";

/**
 * A measure's identity: what its values are a function of. `definition` is the digest of the
 * measure's definition in the suite, and `implementation` the digest of the code that computes its
 * values. A change to either can change a value, so both key the lock, the measurement digest and
 * a stored score.
 */
export const MeasureIdentity = z.strictObject({
  definition: none(Digest.describe("The digest of the measure's definition in the suite.")),
  implementation: none(
    Digest.describe(
      "The digest of the code that computes the values: an instrument's pin, the modules that a module measure loads, or Ichnaea's build for a built-in scorer and a stage status.",
    ),
  ),
});
/** A measure's identity. */
export type MeasureIdentity = z.infer<typeof MeasureIdentity>;

/**
 * The key of a stored score: the trial result that was scored and the identity of the measure that
 * scored it. A score is reused only under an equal key, so a change to a measure's definition or
 * to its code scores the stored result again.
 */
export const ScoreKey = z.strictObject({
  result: none(Digest.describe("The digest of the stored trial result that was scored.")),
  measure: MeasureIdentity.describe("The identity of the measure that scored it."),
});
/** The key of a stored score. */
export type ScoreKey = z.infer<typeof ScoreKey>;
