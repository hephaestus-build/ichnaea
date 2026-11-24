import * as z from "zod";
/** A detector, its scope, and the cases over which its hits are counted. */
export declare const MustNever: z.ZodObject<{
    measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
    cases: z.ZodArray<z.core.$ZodBranded<z.ZodString, "CaseId", "out">>;
    scope: z.ZodString;
    detector: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"deterministic">;
        variants: z.ZodArray<z.ZodObject<{
            pattern: z.ZodString;
            positiveControl: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"model">;
    }, z.core.$strict>], "kind">;
}, z.core.$strict>;
/** The authored declarations before their identifiers are validated. */
export type MustNeverDeclaration = z.input<typeof MustNever>;
/** Counts and the recorded evidence about independence. */
export declare const MustNeverCount: z.ZodObject<{
    measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
    scope: z.ZodString;
    detector: z.ZodEnum<{
        deterministic: "deterministic";
        model: "model";
    }>;
    planned: z.ZodInt;
    clean: z.ZodInt;
    hits: z.ZodInt;
    missing: z.ZodInt;
    cases: z.ZodArray<z.ZodObject<{
        case: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
        planned: z.ZodInt;
        observed: z.ZodInt;
        status: z.ZodEnum<{
            clean: "clean";
            hit: "hit";
            missing: "missing";
        }>;
        contexts: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
    windows: z.ZodArray<z.ZodObject<{
        block: z.ZodInt;
        startedAt: z.ZodISODateTime;
        endedAt: z.ZodISODateTime;
    }, z.core.$strict>>;
    controls: z.ZodArray<z.ZodObject<{
        pattern: z.ZodString;
        case: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
        status: z.ZodEnum<{
            clean: "clean";
            hit: "hit";
            missing: "missing";
        }>;
    }, z.core.$strict>>;
}, z.core.$strict>;
//# sourceMappingURL=must-never.d.ts.map