import * as z from "zod";
/** A module reference: a relative path with no `.` or `..` segment to a JavaScript or TypeScript file. */
export declare const ModulePath: z.ZodString;
/**
 * What computes a measure: a built-in scorer, or an instrument of the suite. A TypeScript measure
 * is a module reference inside its instrument's files, never a function value. Each form has a
 * member that the others lack, so a reader that ignores unknown members still tells them apart.
 */
export declare const ScorerRef: z.ZodXor<readonly [z.ZodObject<{
    builtin: z.ZodString;
    options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
}, z.core.$strict>, z.ZodObject<{
    instrument: z.ZodString;
    module: z.ZodString;
    export: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    instrument: z.ZodString;
    dimension: z.ZodString;
}, z.core.$strict>]>;
/** The cases a measure applies to, fixed before the run: those whose slice is set. */
export declare const AppliesTo: z.ZodObject<{
    slice: z.ZodString;
}, z.core.$strict>;
/** A reduction over the trials of a case: pass^k (`all`) or pass@k (`any`). Estimate-only. */
export declare const TrialReduction: z.ZodXor<readonly [z.ZodObject<{
    all: z.ZodObject<{
        k: z.ZodInt;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    any: z.ZodObject<{
        k: z.ZodInt;
    }, z.core.$strict>;
}, z.core.$strict>]>;
/**
 * How a level measure is tested. With `"equal"`, the levels are equally spaced and the measure is
 * tested as a score on (level − min)/(max − min). Its limits, fidelity margins and the ±0.15
 * arm-bias bound therefore live on [0, 1], and a limit means the same for levels 1–5 as for 0–3.
 * With `{ cut }`, it is tested as binary, with success at or above the cut level registered before
 * the run. With neither, it has no test.
 */
export declare const LevelSpacing: z.ZodXor<readonly [z.ZodLiteral<"equal">, z.ZodObject<{
    cut: z.ZodNumber;
}, z.core.$strict>]>;
/**
 * A measure, by the type of its values. A quantity has a unit and is descriptive only. A level is a
 * number, one of the measure's `levels`, and a scorer reports a level by that value. What a level
 * measure's limits mean depends on its `spacing` (LevelSpacing).
 */
export declare const MeasureDefinition: z.ZodDiscriminatedUnion<[z.ZodObject<{
    stage: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<{
        failed: "failed";
        not_invoked: "not_invoked";
        ok: "ok";
        replayed: "replayed";
        skipped: "skipped";
    }>>;
    iteration: z.ZodOptional<z.ZodEnum<{
        all: "all";
        any: "any";
        first: "first";
        last: "last";
    }>>;
    scorer: z.ZodOptional<z.ZodXor<readonly [z.ZodObject<{
        builtin: z.ZodString;
        options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
    }, z.core.$strict>, z.ZodObject<{
        instrument: z.ZodString;
        module: z.ZodString;
        export: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        instrument: z.ZodString;
        dimension: z.ZodString;
    }, z.core.$strict>]>>;
    appliesTo: z.ZodOptional<z.ZodObject<{
        slice: z.ZodString;
    }, z.core.$strict>>;
    direction: z.ZodOptional<z.ZodEnum<{
        higher: "higher";
        lower: "lower";
    }>>;
    reduce: z.ZodOptional<z.ZodXor<readonly [z.ZodObject<{
        all: z.ZodObject<{
            k: z.ZodInt;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        any: z.ZodObject<{
            k: z.ZodInt;
        }, z.core.$strict>;
    }, z.core.$strict>]>>;
    estimand: z.ZodOptional<z.ZodEnum<{
        population: "population";
        "these-cases": "these-cases";
    }>>;
    weighting: z.ZodOptional<z.ZodEnum<{
        "per-case": "per-case";
        "per-family": "per-family";
    }>>;
    gate: z.ZodOptional<z.ZodBoolean>;
    deterministic: z.ZodOptional<z.ZodBoolean>;
    type: z.ZodLiteral<"binary">;
}, z.core.$strict>, z.ZodObject<{
    stage: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<{
        failed: "failed";
        not_invoked: "not_invoked";
        ok: "ok";
        replayed: "replayed";
        skipped: "skipped";
    }>>;
    iteration: z.ZodOptional<z.ZodEnum<{
        all: "all";
        any: "any";
        first: "first";
        last: "last";
    }>>;
    scorer: z.ZodOptional<z.ZodXor<readonly [z.ZodObject<{
        builtin: z.ZodString;
        options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
    }, z.core.$strict>, z.ZodObject<{
        instrument: z.ZodString;
        module: z.ZodString;
        export: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        instrument: z.ZodString;
        dimension: z.ZodString;
    }, z.core.$strict>]>>;
    appliesTo: z.ZodOptional<z.ZodObject<{
        slice: z.ZodString;
    }, z.core.$strict>>;
    direction: z.ZodOptional<z.ZodEnum<{
        higher: "higher";
        lower: "lower";
    }>>;
    reduce: z.ZodOptional<z.ZodXor<readonly [z.ZodObject<{
        all: z.ZodObject<{
            k: z.ZodInt;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        any: z.ZodObject<{
            k: z.ZodInt;
        }, z.core.$strict>;
    }, z.core.$strict>]>>;
    estimand: z.ZodOptional<z.ZodEnum<{
        population: "population";
        "these-cases": "these-cases";
    }>>;
    weighting: z.ZodOptional<z.ZodEnum<{
        "per-case": "per-case";
        "per-family": "per-family";
    }>>;
    gate: z.ZodOptional<z.ZodBoolean>;
    deterministic: z.ZodOptional<z.ZodBoolean>;
    type: z.ZodLiteral<"score">;
}, z.core.$strict>, z.ZodObject<{
    stage: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<{
        failed: "failed";
        not_invoked: "not_invoked";
        ok: "ok";
        replayed: "replayed";
        skipped: "skipped";
    }>>;
    iteration: z.ZodOptional<z.ZodEnum<{
        all: "all";
        any: "any";
        first: "first";
        last: "last";
    }>>;
    scorer: z.ZodOptional<z.ZodXor<readonly [z.ZodObject<{
        builtin: z.ZodString;
        options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
    }, z.core.$strict>, z.ZodObject<{
        instrument: z.ZodString;
        module: z.ZodString;
        export: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        instrument: z.ZodString;
        dimension: z.ZodString;
    }, z.core.$strict>]>>;
    appliesTo: z.ZodOptional<z.ZodObject<{
        slice: z.ZodString;
    }, z.core.$strict>>;
    direction: z.ZodOptional<z.ZodEnum<{
        higher: "higher";
        lower: "lower";
    }>>;
    reduce: z.ZodOptional<z.ZodXor<readonly [z.ZodObject<{
        all: z.ZodObject<{
            k: z.ZodInt;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        any: z.ZodObject<{
            k: z.ZodInt;
        }, z.core.$strict>;
    }, z.core.$strict>]>>;
    estimand: z.ZodOptional<z.ZodEnum<{
        population: "population";
        "these-cases": "these-cases";
    }>>;
    weighting: z.ZodOptional<z.ZodEnum<{
        "per-case": "per-case";
        "per-family": "per-family";
    }>>;
    gate: z.ZodOptional<z.ZodBoolean>;
    deterministic: z.ZodOptional<z.ZodBoolean>;
    type: z.ZodLiteral<"level">;
    levels: z.ZodArray<z.ZodNumber>;
    anchors: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    spacing: z.ZodOptional<z.ZodXor<readonly [z.ZodLiteral<"equal">, z.ZodObject<{
        cut: z.ZodNumber;
    }, z.core.$strict>]>>;
}, z.core.$strict>, z.ZodObject<{
    stage: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<{
        failed: "failed";
        not_invoked: "not_invoked";
        ok: "ok";
        replayed: "replayed";
        skipped: "skipped";
    }>>;
    iteration: z.ZodOptional<z.ZodEnum<{
        all: "all";
        any: "any";
        first: "first";
        last: "last";
    }>>;
    scorer: z.ZodOptional<z.ZodXor<readonly [z.ZodObject<{
        builtin: z.ZodString;
        options: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
    }, z.core.$strict>, z.ZodObject<{
        instrument: z.ZodString;
        module: z.ZodString;
        export: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        instrument: z.ZodString;
        dimension: z.ZodString;
    }, z.core.$strict>]>>;
    appliesTo: z.ZodOptional<z.ZodObject<{
        slice: z.ZodString;
    }, z.core.$strict>>;
    direction: z.ZodOptional<z.ZodEnum<{
        higher: "higher";
        lower: "lower";
    }>>;
    reduce: z.ZodOptional<z.ZodXor<readonly [z.ZodObject<{
        all: z.ZodObject<{
            k: z.ZodInt;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        any: z.ZodObject<{
            k: z.ZodInt;
        }, z.core.$strict>;
    }, z.core.$strict>]>>;
    estimand: z.ZodOptional<z.ZodEnum<{
        population: "population";
        "these-cases": "these-cases";
    }>>;
    weighting: z.ZodOptional<z.ZodEnum<{
        "per-case": "per-case";
        "per-family": "per-family";
    }>>;
    gate: z.ZodOptional<z.ZodBoolean>;
    deterministic: z.ZodOptional<z.ZodBoolean>;
    type: z.ZodLiteral<"quantity">;
    unit: z.ZodString;
}, z.core.$strict>], "type">;
/** A primary measure's registration: the largest drop accepted, who set it, and why. */
export declare const PrimaryRegistration: z.ZodObject<{
    limit: z.ZodNumber;
    owner: z.ZodString;
    reason: z.ZodString;
}, z.core.$strict>;
//# sourceMappingURL=lock-vocabulary.d.ts.map