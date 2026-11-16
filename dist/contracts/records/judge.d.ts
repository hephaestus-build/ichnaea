import * as z from "zod";
/** A model-based instrument for a measure, defined as data (REQ-32, REQ-37). */
export declare const Judge: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.judge/1">;
    id: z.core.$ZodBranded<z.ZodString, "JudgeId", "out">;
    version: z.ZodString;
    evaluatorKind: z.ZodEnum<{
        code: "code";
        human: "human";
        model: "model";
    }>;
    model: z.ZodOptional<z.ZodObject<{
        provider: z.ZodString;
        id: z.ZodString;
        version: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    endpointClass: z.ZodString;
    promptDigest: z.ZodString;
    rubricDigest: z.ZodString;
    outputSchema: z.ZodJSONSchema;
    outputKind: z.ZodEnum<{
        binary: "binary";
        level: "level";
        preference: "preference";
        score: "score";
    }>;
    parameters: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    swapOrder: z.ZodBoolean;
    repeats: z.ZodInt;
}, z.core.$strict>;
/** A judge record. */
export type Judge = z.infer<typeof Judge>;
/** A label's value: a measured value, or an explicit `unknown` when the rater cannot tell. */
export declare const LabelValue: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
}, z.core.$strict>], "type">;
/** One human or judge annotation on one trial record for one measure (REQ-44). */
export declare const Label: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.label/1">;
    trial: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
    turn: z.ZodOptional<z.ZodInt>;
    measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
    value: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strict>], "type">;
    responseSet: z.ZodOptional<z.ZodArray<z.ZodString>>;
    rater: z.ZodString;
    raterRole: z.ZodEnum<{
        crowd: "crowd";
        developer: "developer";
        expert: "expert";
        judge: "judge";
        user: "user";
    }>;
    source: z.ZodEnum<{
        application: "application";
        bundle: "bundle";
        judge: "judge";
        tool: "tool";
    }>;
    rubricDigest: z.ZodString;
    bundleDigest: z.ZodOptional<z.ZodString>;
    labelledAt: z.ZodISODateTime;
    rationale: z.ZodOptional<z.ZodString>;
    dataClass: z.ZodEnum<{
        none: "none";
        personal: "personal";
        pseudonymous: "pseudonymous";
        special: "special";
    }>;
}, z.core.$strict>;
/** A label. */
export type Label = z.infer<typeof Label>;
/** An agreement estimate with its interval. */
export declare const Agreement: z.ZodObject<{
    statistic: z.ZodEnum<{
        "cohen-kappa": "cohen-kappa";
        "gwet-ac1": "gwet-ac1";
        "krippendorff-alpha": "krippendorff-alpha";
        raw: "raw";
    }>;
    estimate: z.ZodNumber;
    lower: z.ZodNumber;
    upper: z.ZodNumber;
    n: z.ZodInt;
}, z.core.$strict>;
/** The agreement between a judge and human labels, with the judge's status (REQ-39, REQ-40). */
export declare const Calibration: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.calibration/1">;
    judge: z.core.$ZodBranded<z.ZodString, "JudgeId", "out">;
    judgeDigest: z.ZodString;
    measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
    calibrationSet: z.ZodString;
    humanHuman: z.ZodArray<z.ZodObject<{
        statistic: z.ZodEnum<{
            "cohen-kappa": "cohen-kappa";
            "gwet-ac1": "gwet-ac1";
            "krippendorff-alpha": "krippendorff-alpha";
            raw: "raw";
        }>;
        estimate: z.ZodNumber;
        lower: z.ZodNumber;
        upper: z.ZodNumber;
        n: z.ZodInt;
    }, z.core.$strict>>;
    judgeHuman: z.ZodArray<z.ZodObject<{
        statistic: z.ZodEnum<{
            "cohen-kappa": "cohen-kappa";
            "gwet-ac1": "gwet-ac1";
            "krippendorff-alpha": "krippendorff-alpha";
            raw: "raw";
        }>;
        estimate: z.ZodNumber;
        lower: z.ZodNumber;
        upper: z.ZodNumber;
        n: z.ZodInt;
    }, z.core.$strict>>;
    perRater: z.ZodOptional<z.ZodArray<z.ZodObject<{
        rater: z.ZodString;
        items: z.ZodInt;
        agreement: z.ZodArray<z.ZodObject<{
            statistic: z.ZodEnum<{
                "cohen-kappa": "cohen-kappa";
                "gwet-ac1": "gwet-ac1";
                "krippendorff-alpha": "krippendorff-alpha";
                raw: "raw";
            }>;
            estimate: z.ZodNumber;
            lower: z.ZodNumber;
            upper: z.ZodNumber;
            n: z.ZodInt;
        }, z.core.$strict>>;
    }, z.core.$strict>>>;
    confusion: z.ZodArray<z.ZodArray<z.ZodInt>>;
    strata: z.ZodOptional<z.ZodArray<z.ZodString>>;
    tolerance: z.ZodNumber;
    status: z.ZodEnum<{
        calibrated: "calibrated";
        diagnostic: "diagnostic";
        expired: "expired";
    }>;
    expiry: z.ZodArray<z.ZodString>;
    createdAt: z.ZodISODateTime;
}, z.core.$strict>;
/** A calibration record. */
export type Calibration = z.infer<typeof Calibration>;
//# sourceMappingURL=judge.d.ts.map