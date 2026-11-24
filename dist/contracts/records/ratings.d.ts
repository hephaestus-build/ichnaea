import * as z from "zod";
/** One rating in an import. Its value inherits the study's data class. */
export declare const ImportedHumanValue: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.measureValue/1">;
    trial: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
    turn: z.ZodOptional<z.ZodInt>;
    measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
    version: z.ZodString;
    detail: z.ZodOptional<z.ZodString>;
    why: z.ZodOptional<z.ZodString>;
    source: z.ZodLiteral<"human">;
    applicable: z.ZodLiteral<true>;
    dataClass: z.ZodEnum<{
        personal: "personal";
        pseudonymous: "pseudonymous";
        special: "special";
    }>;
    value: z.ZodObject<{
        type: z.ZodLiteral<"level">;
        level: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
/** One imported human rating with the measure and trial it belongs to. */
export type ImportedHumanValue = z.infer<typeof ImportedHumanValue>;
/** The registered judge and the stored measure that supplied its ratings. */
export declare const RatingJudge: z.ZodObject<{
    id: z.core.$ZodBranded<z.ZodString, "JudgeId", "out">;
    digest: z.ZodString;
    measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
    version: z.ZodString;
}, z.core.$strict>;
/** The run's human-rated measures and the matching ordinal calibration input. */
export declare const RatingsImport: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.ratingsImport/1">;
    run: z.core.$ZodBranded<z.ZodString, "RunId", "out">;
    study: z.ZodString;
    source: z.ZodLiteral<"label-studio">;
    registration: z.ZodString;
    dataClass: z.ZodEnum<{
        personal: "personal";
        pseudonymous: "pseudonymous";
        special: "special";
    }>;
    scale: z.ZodArray<z.ZodNumber>;
    judge: z.ZodObject<{
        id: z.core.$ZodBranded<z.ZodString, "JudgeId", "out">;
        digest: z.ZodString;
        measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
        version: z.ZodString;
    }, z.core.$strict>;
    raters: z.ZodArray<z.ZodObject<{
        measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
        version: z.ZodString;
    }, z.core.$strict>>;
    values: z.ZodArray<z.ZodObject<{
        schema: z.ZodLiteral<"ichnaea.measureValue/1">;
        trial: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
        turn: z.ZodOptional<z.ZodInt>;
        measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
        version: z.ZodString;
        detail: z.ZodOptional<z.ZodString>;
        why: z.ZodOptional<z.ZodString>;
        source: z.ZodLiteral<"human">;
        applicable: z.ZodLiteral<true>;
        dataClass: z.ZodEnum<{
            personal: "personal";
            pseudonymous: "pseudonymous";
            special: "special";
        }>;
        value: z.ZodObject<{
            type: z.ZodLiteral<"level">;
            level: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>>;
    units: z.ZodArray<z.ZodObject<{
        trial: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
        item: z.ZodString;
        stratum: z.ZodString;
        configuration: z.ZodEnum<{
            base: "base";
            candidate: "candidate";
            "known-worse": "known-worse";
        }>;
        judge: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
/** A stored rating import. */
export type RatingsImport = z.infer<typeof RatingsImport>;
//# sourceMappingURL=ratings.d.ts.map