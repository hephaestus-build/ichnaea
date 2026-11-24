import * as z from "zod";
/** The question an estimate answers (REQ-49). */
export declare const Estimand: z.ZodEnum<{
    "fixed-cases": "fixed-cases";
    "sampled-cases": "sampled-cases";
}>;
/** An estimand. */
export type Estimand = z.infer<typeof Estimand>;
/** What a CI policy does with a verdict that is not PASS (REQ-26, REQ-27). */
export declare const PolicyAction: z.ZodEnum<{
    block: "block";
    report: "report";
}>;
/**
 * The CI policy of a suite. INCONCLUSIVE and estimate-only must have a stated action (REQ-27). An
 * INVALID run always blocks, so it has no action to choose: INVALID never maps to a pass (REQ-53).
 */
export declare const CiPolicy: z.ZodObject<{
    onRegression: z.ZodEnum<{
        block: "block";
        report: "report";
    }>;
    onInconclusive: z.ZodEnum<{
        block: "block";
        report: "report";
    }>;
    onRunDrop: z.ZodOptional<z.ZodEnum<{
        block: "block";
        report: "report";
    }>>;
    onEstimateOnly: z.ZodEnum<{
        block: "block";
        report: "report";
    }>;
}, z.core.$strict>;
/** The run budget (REQ-21). */
export declare const Budget: z.ZodObject<{
    maxCalls: z.ZodInt;
    callsPerTrial: z.ZodInt;
    maxCost: z.ZodOptional<z.ZodNumber>;
    costUnit: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/**
 * Whether a margin is registered by the measure's owner, or a placeholder. A placeholder margin
 * gives no verdict: the plan runs estimate-only (decision 0012).
 */
export declare const MarginStatus: z.ZodEnum<{
    placeholder: "placeholder";
    registered: "registered";
}>;
/** A primary measure with its margin and optional safety margin. */
export declare const PrimaryMeasure: z.ZodObject<{
    measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
    margin: z.ZodNumber;
    marginStatus: z.ZodEnum<{
        placeholder: "placeholder";
        registered: "registered";
    }>;
    marginReason: z.ZodString;
    safetyMargin: z.ZodOptional<z.ZodNumber>;
    coverageFloor: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
/**
 * More trials for the cases of one slice, for example a measure that applies to few cases: every
 * case whose `slices[slice]` is `value` runs `replicates` trials per arm. A case that several
 * entries match runs the largest count.
 */
export declare const ReplicatesFor: z.ZodObject<{
    slice: z.ZodString;
    value: z.ZodString;
    replicates: z.ZodInt;
    reason: z.ZodString;
}, z.core.$strict>;
/** A reference to the case set a suite evaluates. */
export declare const CaseSetRef: z.ZodObject<{
    id: z.core.$ZodBranded<z.ZodString, "CaseSetId", "out">;
    path: z.ZodString;
    digest: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/** A suite: what an application declares it evaluates (REQ-16, REQ-115). It names no system. */
export declare const Suite: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.suite/1">;
    id: z.core.$ZodBranded<z.ZodString, "SuiteId", "out">;
    version: z.ZodString;
    objective: z.ZodString;
    construct: z.ZodString;
    decision: z.ZodString;
    scope: z.ZodString;
    nonCoverage: z.ZodString;
    estimand: z.ZodEnum<{
        "fixed-cases": "fixed-cases";
        "sampled-cases": "sampled-cases";
    }>;
    caseSet: z.ZodObject<{
        id: z.core.$ZodBranded<z.ZodString, "CaseSetId", "out">;
        path: z.ZodString;
        digest: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    pools: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        development: "development";
        promoted: "promoted";
        sealed: "sealed";
        validation: "validation";
    }>>>;
    replicates: z.ZodInt;
    replicatesFor: z.ZodOptional<z.ZodArray<z.ZodObject<{
        slice: z.ZodString;
        value: z.ZodString;
        replicates: z.ZodInt;
        reason: z.ZodString;
    }, z.core.$strict>>>;
    alpha: z.ZodOptional<z.ZodNumber>;
    primary: z.ZodArray<z.ZodObject<{
        measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
        margin: z.ZodNumber;
        marginStatus: z.ZodEnum<{
            placeholder: "placeholder";
            registered: "registered";
        }>;
        marginReason: z.ZodString;
        safetyMargin: z.ZodOptional<z.ZodNumber>;
        coverageFloor: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    secondary: z.ZodOptional<z.ZodArray<z.core.$ZodBranded<z.ZodString, "MeasureId", "out">>>;
    hardGates: z.ZodOptional<z.ZodArray<z.core.$ZodBranded<z.ZodString, "GateId", "out">>>;
    budget: z.ZodObject<{
        maxCalls: z.ZodInt;
        callsPerTrial: z.ZodInt;
        maxCost: z.ZodOptional<z.ZodNumber>;
        costUnit: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    policy: z.ZodObject<{
        onRegression: z.ZodEnum<{
            block: "block";
            report: "report";
        }>;
        onInconclusive: z.ZodEnum<{
            block: "block";
            report: "report";
        }>;
        onRunDrop: z.ZodOptional<z.ZodEnum<{
            block: "block";
            report: "report";
        }>>;
        onEstimateOnly: z.ZodEnum<{
            block: "block";
            report: "report";
        }>;
    }, z.core.$strict>;
    threats: z.ZodOptional<z.ZodArray<z.ZodString>>;
    measureReviewDate: z.ZodISODate;
    paths: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
/** A suite. */
export type Suite = z.infer<typeof Suite>;
//# sourceMappingURL=suite.d.ts.map