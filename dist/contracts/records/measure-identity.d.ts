import * as z from "zod";
/**
 * A measure's identity: what its values are a function of. `definition` is the digest of the
 * measure's definition in the suite, and `implementation` the digest of the code that computes its
 * values. A change to either can change a value, so both key the lock, the measurement digest and
 * a stored score.
 */
export declare const MeasureIdentity: z.ZodObject<{
    definition: z.ZodString;
    implementation: z.ZodString;
}, z.core.$strict>;
/** A measure's identity. */
export type MeasureIdentity = z.infer<typeof MeasureIdentity>;
/**
 * The key of a stored score: the trial result that was scored, the case it was scored against and
 * the identity of the measure that scored it. A score is reused only under an equal key, so a
 * change to a measure's definition or code, or a corrected reference of the case, scores the
 * stored result again.
 */
export declare const ScoreKey: z.ZodObject<{
    result: z.ZodString;
    case: z.ZodString;
    measure: z.ZodObject<{
        definition: z.ZodString;
        implementation: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
/** The key of a stored score. */
export type ScoreKey = z.infer<typeof ScoreKey>;
//# sourceMappingURL=measure-identity.d.ts.map