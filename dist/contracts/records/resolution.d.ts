import * as z from "zod";
/** The evidence behind a per-measure resolution estimate. */
export declare const Resolution: z.ZodObject<{
    measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
    basis: z.ZodEnum<{
        "base-arm-rates": "base-arm-rates";
        "default-simulation": "default-simulation";
        "noise-pilot": "noise-pilot";
    }>;
    targetPower: z.ZodNumber;
    level: z.ZodNumber;
    targetDrop: z.ZodOptional<z.ZodNumber>;
    powerAtTarget: z.ZodOptional<z.ZodNumber>;
    result: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"detectable-drop">;
        drop: z.ZodNumber;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"extreme">;
        power: z.ZodNumber;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"unavailable">;
        reason: z.ZodString;
    }, z.core.$strict>], "kind">;
}, z.core.$strict>;
/** One measure's resolution estimate. */
export type Resolution = z.infer<typeof Resolution>;
//# sourceMappingURL=resolution.d.ts.map