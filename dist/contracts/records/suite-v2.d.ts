import * as z from "zod";
/** What a suite evaluates and what it does not. `doctor` and the card read it; it decides nothing. */
export declare const SuiteAbout: z.ZodObject<{
    objective: z.ZodString;
    decision: z.ZodString;
    construct: z.ZodString;
    scope: z.ZodString;
    nonCoverage: z.ZodArray<z.ZodString>;
    threats: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
/** One case file of a dataset that the project config names. */
export declare const DatasetFile: z.ZodObject<{
    dataset: z.ZodString;
    path: z.ZodString;
}, z.core.$strict>;
/**
 * The sampling frame of the cases. Only a measure with the `population` estimand may use it.
 */
export declare const SamplingFrame: z.ZodObject<{
    population: z.ZodString;
    drawnBy: z.ZodString;
    date: z.ZodISODate;
}, z.core.$strict>;
/**
 * For each pool, the label that marks its cases. Only the validation pool takes a reuse budget:
 * past `maxReads` registered reads since it was frozen, the card says it is over its budget.
 */
export declare const CasePools: z.ZodObject<{
    development: z.ZodOptional<z.ZodObject<{
        label: z.ZodString;
    }, z.core.$strict>>;
    validation: z.ZodOptional<z.ZodObject<{
        label: z.ZodString;
        maxReads: z.ZodOptional<z.ZodInt>;
    }, z.core.$strict>>;
    sealed: z.ZodOptional<z.ZodObject<{
        label: z.ZodString;
    }, z.core.$strict>>;
    promoted: z.ZodOptional<z.ZodObject<{
        label: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
/** Where a suite's cases come from: files of named datasets, or one source. */
export declare const SuiteCases: z.ZodXor<readonly [z.ZodObject<{
    exposure: z.ZodOptional<z.ZodEnum<{
        private: "private";
        public: "public";
        sealed: "sealed";
    }>>;
    pools: z.ZodOptional<z.ZodObject<{
        development: z.ZodOptional<z.ZodObject<{
            label: z.ZodString;
        }, z.core.$strict>>;
        validation: z.ZodOptional<z.ZodObject<{
            label: z.ZodString;
            maxReads: z.ZodOptional<z.ZodInt>;
        }, z.core.$strict>>;
        sealed: z.ZodOptional<z.ZodObject<{
            label: z.ZodString;
        }, z.core.$strict>>;
        promoted: z.ZodOptional<z.ZodObject<{
            label: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    frame: z.ZodOptional<z.ZodObject<{
        population: z.ZodString;
        drawnBy: z.ZodString;
        date: z.ZodISODate;
    }, z.core.$strict>>;
    from: z.ZodArray<z.ZodObject<{
        dataset: z.ZodString;
        path: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    exposure: z.ZodOptional<z.ZodEnum<{
        private: "private";
        public: "public";
        sealed: "sealed";
    }>>;
    pools: z.ZodOptional<z.ZodObject<{
        development: z.ZodOptional<z.ZodObject<{
            label: z.ZodString;
        }, z.core.$strict>>;
        validation: z.ZodOptional<z.ZodObject<{
            label: z.ZodString;
            maxReads: z.ZodOptional<z.ZodInt>;
        }, z.core.$strict>>;
        sealed: z.ZodOptional<z.ZodObject<{
            label: z.ZodString;
        }, z.core.$strict>>;
        promoted: z.ZodOptional<z.ZodObject<{
            label: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    frame: z.ZodOptional<z.ZodObject<{
        population: z.ZodString;
        drawnBy: z.ZodString;
        date: z.ZodISODate;
    }, z.core.$strict>>;
    source: z.ZodXor<readonly [z.ZodObject<{
        file: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        git: z.ZodObject<{
            repo: z.ZodString;
            commit: z.ZodString;
            path: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        https: z.ZodXor<readonly [z.ZodObject<{
            url: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            fromEnv: z.ZodString;
        }, z.core.$strict>]>;
        digest: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        command: z.ZodArray<z.ZodString>;
        output: z.ZodString;
        env: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>]>;
}, z.core.$strict>]>;
/** A module reference: a relative path with no `.` or `..` segment to a JavaScript or TypeScript file. */
export declare const ModulePath: z.ZodString;
/** Runs another runner and imports what it wrote: a command or a module that writes the batch. */
export declare const SuiteImport: z.ZodXor<readonly [z.ZodObject<{
    command: z.ZodArray<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    module: z.ZodString;
}, z.core.$strict>]>;
/**
 * An environment factor: something the system reads that is neither the system nor an
 * instrument, such as an index. It is the same in both arms unless the plan declares it changed.
 */
export declare const EnvironmentFactor: z.ZodXor<readonly [z.ZodObject<{
    class: z.ZodOptional<z.ZodEnum<{
        none: "none";
        personal: "personal";
        pseudonymous: "pseudonymous";
        special: "special";
    }>>;
    exposure: z.ZodOptional<z.ZodEnum<{
        private: "private";
        public: "public";
        sealed: "sealed";
    }>>;
    path: z.ZodObject<{
        fromEnv: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    class: z.ZodOptional<z.ZodEnum<{
        none: "none";
        personal: "personal";
        pseudonymous: "pseudonymous";
        special: "special";
    }>>;
    exposure: z.ZodOptional<z.ZodEnum<{
        private: "private";
        public: "public";
        sealed: "sealed";
    }>>;
    service: z.ZodObject<{
        fromEnv: z.ZodString;
    }, z.core.$strict>;
    identity: z.ZodString;
}, z.core.$strict>]>;
/** The model identity of a judge instrument. Its parameters are part of the judge identity. */
export declare const JudgeSettings: z.ZodObject<{
    model: z.ZodString;
    prompt: z.ZodString;
    rubric: z.ZodString;
    parameters: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodXor<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>>;
}, z.core.$strict>;
/** A model that an instrument downloads at run time, pinned by revision. */
export declare const PinnedModel: z.ZodObject<{
    name: z.ZodString;
    revision: z.ZodString;
}, z.core.$strict>;
/**
 * An instrument: anything that measures, always the base's. It runs from a copy of its `files`,
 * which are globs over tracked files only and include its language's lockfile.
 */
export declare const InstrumentSettings: z.ZodObject<{
    command: z.ZodOptional<z.ZodArray<z.ZodString>>;
    prepare: z.ZodOptional<z.ZodArray<z.ZodString>>;
    files: z.ZodOptional<z.ZodArray<z.ZodString>>;
    exclude: z.ZodOptional<z.ZodArray<z.ZodString>>;
    image: z.ZodOptional<z.ZodString>;
    judge: z.ZodOptional<z.ZodObject<{
        model: z.ZodString;
        prompt: z.ZodString;
        rubric: z.ZodString;
        parameters: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodXor<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>>;
    }, z.core.$strict>>;
    models: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        revision: z.ZodString;
    }, z.core.$strict>>>;
    env: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        secret: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>>;
    endpoints: z.ZodOptional<z.ZodArray<z.ZodString>>;
    imported: z.ZodOptional<z.ZodObject<{
        version: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>>;
    deadline: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
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
/** Which measures decide, which are reported, and which only explain. */
export declare const SuitePolicy: z.ZodObject<{
    primary: z.ZodRecord<z.ZodString, z.ZodObject<{
        limit: z.ZodNumber;
        owner: z.ZodString;
        reason: z.ZodString;
    }, z.core.$strict>>;
    secondary: z.ZodOptional<z.ZodArray<z.ZodString>>;
    diagnostic: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
/** The call budget of a run. `rejectedPerTrial` defaults to `callsPerTrial`. */
export declare const SuiteBudget: z.ZodObject<{
    calls: z.ZodInt;
    callsPerTrial: z.ZodInt;
    rejectedPerTrial: z.ZodOptional<z.ZodInt>;
    judgeCalls: z.ZodOptional<z.ZodInt>;
    costMicros: z.ZodOptional<z.ZodInt>;
}, z.core.$strict>;
/** A profile's budget: any field of the suite budget. */
export declare const ProfileBudget: z.ZodObject<{
    calls: z.ZodOptional<z.ZodInt>;
    callsPerTrial: z.ZodOptional<z.ZodInt>;
    rejectedPerTrial: z.ZodOptional<z.ZodOptional<z.ZodInt>>;
    judgeCalls: z.ZodOptional<z.ZodOptional<z.ZodInt>>;
    costMicros: z.ZodOptional<z.ZodOptional<z.ZodInt>>;
}, z.core.$strict>;
/**
 * A named set of run settings. It cannot change the policy, the primary measures or the limits.
 */
export declare const RunProfile: z.ZodObject<{
    trials: z.ZodOptional<z.ZodInt>;
    mode: z.ZodOptional<z.ZodEnum<{
        confirm: "confirm";
        fast: "fast";
    }>>;
    pool: z.ZodOptional<z.ZodEnum<{
        development: "development";
        promoted: "promoted";
        sealed: "sealed";
        validation: "validation";
    }>>;
    cases: z.ZodOptional<z.ZodInt>;
    budget: z.ZodOptional<z.ZodObject<{
        calls: z.ZodOptional<z.ZodInt>;
        callsPerTrial: z.ZodOptional<z.ZodInt>;
        rejectedPerTrial: z.ZodOptional<z.ZodOptional<z.ZodInt>>;
        judgeCalls: z.ZodOptional<z.ZodOptional<z.ZodInt>>;
        costMicros: z.ZodOptional<z.ZodOptional<z.ZodInt>>;
    }, z.core.$strict>>;
    shards: z.ZodOptional<z.ZodInt>;
}, z.core.$strict>;
/** The class of a stop reason, as the base maps it. */
export declare const StopClass: z.ZodEnum<{
    completed: "completed";
    infrastructure: "infrastructure";
    not_invoked: "not_invoked";
    system: "system";
}>;
/**
 * A stop reason's class. A reason that reports the system's own verdict on its output is
 * `selfVerdict: true` and maps to `completed`.
 */
export declare const StopMapping: z.ZodXor<readonly [z.ZodEnum<{
    completed: "completed";
    infrastructure: "infrastructure";
    not_invoked: "not_invoked";
    system: "system";
}>, z.ZodObject<{
    class: z.ZodEnum<{
        completed: "completed";
        infrastructure: "infrastructure";
        not_invoked: "not_invoked";
        system: "system";
    }>;
    selfVerdict: z.ZodBoolean;
}, z.core.$strict>]>;
/**
 * A suite (`ichnaea.suite/2`): one thing you evaluate, as plain JSON data. It is the canonical form
 * of a `suite.ts` or `suite.jsonc` file. Paths are relative to the suite file's directory. Exactly
 * one of `worker` and `import` says how trials are produced.
 */
export declare const SuiteV2: z.ZodObject<{
    $schema: z.ZodOptional<z.ZodString>;
    schema: z.ZodLiteral<"ichnaea.suite/2">;
    id: z.core.$ZodBranded<z.ZodString, "SuiteId", "out">;
    version: z.ZodOptional<z.ZodString>;
    about: z.ZodObject<{
        objective: z.ZodString;
        decision: z.ZodString;
        construct: z.ZodString;
        scope: z.ZodString;
        nonCoverage: z.ZodArray<z.ZodString>;
        threats: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
    cases: z.ZodXor<readonly [z.ZodObject<{
        exposure: z.ZodOptional<z.ZodEnum<{
            private: "private";
            public: "public";
            sealed: "sealed";
        }>>;
        pools: z.ZodOptional<z.ZodObject<{
            development: z.ZodOptional<z.ZodObject<{
                label: z.ZodString;
            }, z.core.$strict>>;
            validation: z.ZodOptional<z.ZodObject<{
                label: z.ZodString;
                maxReads: z.ZodOptional<z.ZodInt>;
            }, z.core.$strict>>;
            sealed: z.ZodOptional<z.ZodObject<{
                label: z.ZodString;
            }, z.core.$strict>>;
            promoted: z.ZodOptional<z.ZodObject<{
                label: z.ZodString;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        frame: z.ZodOptional<z.ZodObject<{
            population: z.ZodString;
            drawnBy: z.ZodString;
            date: z.ZodISODate;
        }, z.core.$strict>>;
        from: z.ZodArray<z.ZodObject<{
            dataset: z.ZodString;
            path: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>, z.ZodObject<{
        exposure: z.ZodOptional<z.ZodEnum<{
            private: "private";
            public: "public";
            sealed: "sealed";
        }>>;
        pools: z.ZodOptional<z.ZodObject<{
            development: z.ZodOptional<z.ZodObject<{
                label: z.ZodString;
            }, z.core.$strict>>;
            validation: z.ZodOptional<z.ZodObject<{
                label: z.ZodString;
                maxReads: z.ZodOptional<z.ZodInt>;
            }, z.core.$strict>>;
            sealed: z.ZodOptional<z.ZodObject<{
                label: z.ZodString;
            }, z.core.$strict>>;
            promoted: z.ZodOptional<z.ZodObject<{
                label: z.ZodString;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        frame: z.ZodOptional<z.ZodObject<{
            population: z.ZodString;
            drawnBy: z.ZodString;
            date: z.ZodISODate;
        }, z.core.$strict>>;
        source: z.ZodXor<readonly [z.ZodObject<{
            file: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            git: z.ZodObject<{
                repo: z.ZodString;
                commit: z.ZodString;
                path: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            https: z.ZodXor<readonly [z.ZodObject<{
                url: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                fromEnv: z.ZodString;
            }, z.core.$strict>]>;
            digest: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            command: z.ZodArray<z.ZodString>;
            output: z.ZodString;
            env: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>]>;
    }, z.core.$strict>]>;
    worker: z.ZodOptional<z.ZodXor<readonly [z.ZodString, z.ZodObject<{
        command: z.ZodArray<z.ZodString>;
        prepare: z.ZodOptional<z.ZodArray<z.ZodString>>;
        env: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            secret: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>>>;
        envFile: z.ZodOptional<z.ZodString>;
        endpoints: z.ZodOptional<z.ZodArray<z.ZodString>>;
        capacity: z.ZodOptional<z.ZodInt>;
        processes: z.ZodOptional<z.ZodInt>;
        startTimeout: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>]>>;
    import: z.ZodOptional<z.ZodXor<readonly [z.ZodObject<{
        command: z.ZodArray<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        module: z.ZodString;
    }, z.core.$strict>]>>;
    configuration: z.ZodOptional<z.ZodObject<{
        record: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
    stages: z.ZodOptional<z.ZodArray<z.ZodString>>;
    entry: z.ZodOptional<z.ZodString>;
    environment: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodXor<readonly [z.ZodObject<{
        class: z.ZodOptional<z.ZodEnum<{
            none: "none";
            personal: "personal";
            pseudonymous: "pseudonymous";
            special: "special";
        }>>;
        exposure: z.ZodOptional<z.ZodEnum<{
            private: "private";
            public: "public";
            sealed: "sealed";
        }>>;
        path: z.ZodObject<{
            fromEnv: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        class: z.ZodOptional<z.ZodEnum<{
            none: "none";
            personal: "personal";
            pseudonymous: "pseudonymous";
            special: "special";
        }>>;
        exposure: z.ZodOptional<z.ZodEnum<{
            private: "private";
            public: "public";
            sealed: "sealed";
        }>>;
        service: z.ZodObject<{
            fromEnv: z.ZodString;
        }, z.core.$strict>;
        identity: z.ZodString;
    }, z.core.$strict>]>>>;
    instruments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        command: z.ZodOptional<z.ZodArray<z.ZodString>>;
        prepare: z.ZodOptional<z.ZodArray<z.ZodString>>;
        files: z.ZodOptional<z.ZodArray<z.ZodString>>;
        exclude: z.ZodOptional<z.ZodArray<z.ZodString>>;
        image: z.ZodOptional<z.ZodString>;
        judge: z.ZodOptional<z.ZodObject<{
            model: z.ZodString;
            prompt: z.ZodString;
            rubric: z.ZodString;
            parameters: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodXor<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>>;
        }, z.core.$strict>>;
        models: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            revision: z.ZodString;
        }, z.core.$strict>>>;
        env: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            secret: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>>>;
        endpoints: z.ZodOptional<z.ZodArray<z.ZodString>>;
        imported: z.ZodOptional<z.ZodObject<{
            version: z.ZodString;
            digest: z.ZodString;
        }, z.core.$strict>>;
        deadline: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>>;
    measures: z.ZodRecord<z.ZodString, z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strict>], "type">>;
    policy: z.ZodObject<{
        primary: z.ZodRecord<z.ZodString, z.ZodObject<{
            limit: z.ZodNumber;
            owner: z.ZodString;
            reason: z.ZodString;
        }, z.core.$strict>>;
        secondary: z.ZodOptional<z.ZodArray<z.ZodString>>;
        diagnostic: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    profiles: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        trials: z.ZodOptional<z.ZodInt>;
        mode: z.ZodOptional<z.ZodEnum<{
            confirm: "confirm";
            fast: "fast";
        }>>;
        pool: z.ZodOptional<z.ZodEnum<{
            development: "development";
            promoted: "promoted";
            sealed: "sealed";
            validation: "validation";
        }>>;
        cases: z.ZodOptional<z.ZodInt>;
        budget: z.ZodOptional<z.ZodObject<{
            calls: z.ZodOptional<z.ZodInt>;
            callsPerTrial: z.ZodOptional<z.ZodInt>;
            rejectedPerTrial: z.ZodOptional<z.ZodOptional<z.ZodInt>>;
            judgeCalls: z.ZodOptional<z.ZodOptional<z.ZodInt>>;
            costMicros: z.ZodOptional<z.ZodOptional<z.ZodInt>>;
        }, z.core.$strict>>;
        shards: z.ZodOptional<z.ZodInt>;
    }, z.core.$strict>>>;
    budget: z.ZodObject<{
        calls: z.ZodInt;
        callsPerTrial: z.ZodInt;
        rejectedPerTrial: z.ZodOptional<z.ZodInt>;
        judgeCalls: z.ZodOptional<z.ZodInt>;
        costMicros: z.ZodOptional<z.ZodInt>;
    }, z.core.$strict>;
    limits: z.ZodOptional<z.ZodObject<{
        artifactBytes: z.ZodOptional<z.ZodInt>;
        outputBytes: z.ZodOptional<z.ZodInt>;
        trialDeadline: z.ZodOptional<z.ZodString>;
        wallClockMax: z.ZodOptional<z.ZodString>;
        missingMax: z.ZodOptional<z.ZodNumber>;
        throttleMax: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    baselines: z.ZodOptional<z.ZodObject<{
        freshness: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    stopReasons: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodXor<readonly [z.ZodEnum<{
        completed: "completed";
        infrastructure: "infrastructure";
        not_invoked: "not_invoked";
        system: "system";
    }>, z.ZodObject<{
        class: z.ZodEnum<{
            completed: "completed";
            infrastructure: "infrastructure";
            not_invoked: "not_invoked";
            system: "system";
        }>;
        selfVerdict: z.ZodBoolean;
    }, z.core.$strict>]>>>;
    attribute: z.ZodOptional<z.ZodObject<{
        fidelityMargin: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    }, z.core.$strict>>;
    deterministic: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
/** A suite at major 2. */
export type SuiteV2 = z.infer<typeof SuiteV2>;
//# sourceMappingURL=suite-v2.d.ts.map