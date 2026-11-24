import * as z from "zod";
/** The definition of a measure (REQ-29). A measure without a card does not register. */
export declare const MeasureCard: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.measureCard/1">;
    id: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
    version: z.ZodString;
    construct: z.ZodString;
    operationalDefinition: z.ZodString;
    valueType: z.ZodEnum<{
        binary: "binary";
        level: "level";
        preference: "preference";
        proportion: "proportion";
        score: "score";
    }>;
    levels: z.ZodOptional<z.ZodArray<z.ZodString>>;
    unit: z.ZodString;
    direction: z.ZodEnum<{
        higher: "higher";
        lower: "lower";
    }>;
    scale: z.ZodOptional<z.ZodObject<{
        min: z.ZodNumber;
        max: z.ZodNumber;
    }, z.core.$strict>>;
    justification: z.ZodString;
    errorModel: z.ZodString;
    applicability: z.ZodString;
    tier: z.ZodEnum<{
        diagnostic: "diagnostic";
        primary: "primary";
        secondary: "secondary";
    }>;
    composite: z.ZodOptional<z.ZodBoolean>;
    unitOfEvaluation: z.ZodEnum<{
        episode: "episode";
        session: "session";
        trace: "trace";
        turn: "turn";
    }>;
    establishes: z.ZodString;
    computedBy: z.ZodEnum<{
        application: "application";
        ichnaea: "ichnaea";
        judge: "judge";
    }>;
    judge: z.ZodOptional<z.core.$ZodBranded<z.ZodString, "JudgeId", "out">>;
    validation: z.ZodOptional<z.ZodObject<{
        tester: z.ZodOptional<z.ZodObject<{
            status: z.ZodEnum<{
                failed: "failed";
                passed: "passed";
            }>;
            digest: z.ZodString;
            instrumentPin: z.ZodOptional<z.ZodString>;
            ranAt: z.ZodISODateTime;
        }, z.core.$strict>>;
        calibration: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
/** A measure card. */
export type MeasureCard = z.infer<typeof MeasureCard>;
/**
 * One measure value on one trial (or one turn of it). `applicable: false` is not applicable,
 * never zero or missing, and has no value (REQ-30). An application-computed value names its source
 * (REQ-31).
 */
export declare const MeasureValue: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.measureValue/1">;
    trial: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
    turn: z.ZodOptional<z.ZodInt>;
    measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
    version: z.ZodString;
    applicable: z.ZodBoolean;
    value: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"binary">;
        pass: z.ZodBoolean;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"score">;
        value: z.ZodUnion<readonly [z.ZodNumber, z.ZodObject<{
            nonFinite: z.ZodEnum<{
                "-inf": "-inf";
                inf: "inf";
                nan: "nan";
            }>;
        }, z.core.$strict>]>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"proportion">;
        successes: z.ZodInt;
        trials: z.ZodInt;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"level">;
        level: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"preference">;
        preferred: z.ZodEnum<{
            first: "first";
            second: "second";
            tie: "tie";
        }>;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"unknown">;
    }, z.core.$strict>], "type">>;
    source: z.ZodEnum<{
        application: "application";
        human: "human";
        ichnaea: "ichnaea";
        judge: "judge";
    }>;
    detail: z.ZodOptional<z.ZodString>;
    why: z.ZodOptional<z.ZodString>;
    dataClass: z.ZodEnum<{
        none: "none";
        personal: "personal";
        pseudonymous: "pseudonymous";
        special: "special";
    }>;
}, z.core.$strict>;
/** A measure value. */
export type MeasureValue = z.infer<typeof MeasureValue>;
//# sourceMappingURL=measure.d.ts.map