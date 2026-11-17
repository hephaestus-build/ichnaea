import * as z from "zod";
import { none } from "../data-class.js";
import { Digest } from "../primitives.js";
/**
 * A measure's identity: what its values are a function of. `definition` is the digest of the
 * measure's definition in the suite, and `implementation` the digest of the code that computes its
 * values. A change to either can change a value, so both key the lock, the measurement digest and
 * a stored score.
 */
export const MeasureIdentity = z.strictObject({
    definition: none(Digest.describe("The digest of the measure's definition in the suite.")),
    implementation: none(Digest.describe("The digest of the code that computes the values: an instrument's pin; for a module measure, the modules that its module loads with the pin of its instrument; or Ichnaea's build for a built-in scorer and a stage status.")),
});
/**
 * The key of a stored score: the trial result that was scored, the case it was scored against and
 * the identity of the measure that scored it. A score is reused only under an equal key, so a
 * change to a measure's definition or code, or a corrected reference of the case, scores the
 * stored result again.
 */
export const ScoreKey = z.strictObject({
    result: none(Digest.describe("The digest of the stored trial result that was scored.")),
    case: none(Digest.describe("The digest of the case that it was scored against, its references included.")),
    measure: MeasureIdentity.describe("The identity of the measure that scored it."),
});
//# sourceMappingURL=measure-identity.js.map