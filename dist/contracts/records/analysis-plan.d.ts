import * as z from "zod";
/** Which cases a measure can use. The keys and case IDs come from the plan. */
export declare const Applicability: z.ZodRecord<z.core.$ZodBranded<z.ZodString, "MeasureId", "out">, z.ZodArray<z.core.$ZodBranded<z.ZodString, "CaseId", "out">>>;
/** One locked primary comparison. A margin is needed only for a non-inferiority claim. */
export declare const AnalysisPrimary: z.ZodObject<{
    measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
    margin: z.ZodOptional<z.ZodNumber>;
    safetyMargin: z.ZodOptional<z.ZodNumber>;
    targetDrop: z.ZodOptional<z.ZodNumber>;
    coverageFloor: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
/** Use the same registered number of fresh binary trials for each selected case. */
export declare const RegisteredTrialReduction: z.ZodObject<{
    measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
    k: z.ZodInt;
    cases: z.ZodArray<z.core.$ZodBranded<z.ZodString, "CaseId", "out">>;
}, z.core.$strict>;
/** Authored reduction settings before their identifiers are validated. */
export type TrialReductionRegistration = z.input<typeof RegisteredTrialReduction>;
/** Analysis that can be registered before a candidate exists. */
export declare const AnalysisPlan: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.analysisPlan/1">;
    suite: z.core.$ZodBranded<z.ZodString, "SuiteId", "out">;
    suiteDigest: z.ZodString;
    cases: z.ZodArray<z.ZodObject<{
        id: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
        digest: z.ZodString;
        pool: z.ZodEnum<{
            development: "development";
            promoted: "promoted";
            sealed: "sealed";
            validation: "validation";
        }>;
        family: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    caseSet: z.ZodString;
    caseSetDigest: z.ZodString;
    estimand: z.ZodEnum<{
        "fixed-cases": "fixed-cases";
        "sampled-cases": "sampled-cases";
    }>;
    method: z.ZodEnum<{
        "binary-randomized-blocks": "binary-randomized-blocks";
        "estimate-only": "estimate-only";
    }>;
    alpha: z.ZodNumber;
    blocks: z.ZodInt;
    replicates: z.ZodInt;
    primary: z.ZodArray<z.ZodObject<{
        measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
        margin: z.ZodOptional<z.ZodNumber>;
        safetyMargin: z.ZodOptional<z.ZodNumber>;
        targetDrop: z.ZodOptional<z.ZodNumber>;
        coverageFloor: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    secondary: z.ZodArray<z.core.$ZodBranded<z.ZodString, "MeasureId", "out">>;
    hardGates: z.ZodArray<z.core.$ZodBranded<z.ZodString, "GateId", "out">>;
    measures: z.ZodArray<z.ZodObject<{
        id: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
        version: z.ZodString;
        pin: z.ZodString;
    }, z.core.$strict>>;
    holm: z.ZodArray<z.core.$ZodBranded<z.ZodString, "MeasureId", "out">>;
    applicability: z.ZodRecord<z.core.$ZodBranded<z.ZodString, "MeasureId", "out">, z.ZodArray<z.core.$ZodBranded<z.ZodString, "CaseId", "out">>>;
    resolution: z.ZodOptional<z.ZodArray<z.ZodObject<{
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
    }, z.core.$strict>>>;
    trialReduction: z.ZodOptional<z.ZodObject<{
        measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
        k: z.ZodInt;
        cases: z.ZodArray<z.core.$ZodBranded<z.ZodString, "CaseId", "out">>;
    }, z.core.$strict>>;
    mustNever: z.ZodOptional<z.ZodArray<z.ZodObject<{
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
    }, z.core.$strict>>>;
    pilot: z.ZodOptional<z.ZodObject<{
        run: z.core.$ZodBranded<z.ZodString, "RunId", "out">;
        digest: z.ZodString;
    }, z.core.$strict>>;
    base: z.ZodObject<{
        role: z.ZodLiteral<"base">;
        identity: z.core.$ZodBranded<z.ZodString, "ConfigurationIdentity", "out">;
    }, z.core.$strict>;
    maxCalls: z.ZodInt;
    policy: z.ZodObject<{
        onRegression: z.ZodEnum<{
            block: "block";
            report: "report";
        }>;
        onInconclusive: z.ZodEnum<{
            block: "block";
            report: "report";
        }>;
        onEstimateOnly: z.ZodEnum<{
            block: "block";
            report: "report";
        }>;
    }, z.core.$strict>;
    ichnaea: z.ZodString;
}, z.core.$strict>;
/** A locked analysis plan. */
export type AnalysisPlan = z.infer<typeof AnalysisPlan>;
/** The case and measure pins for the plan written beside this lock. */
export declare const AnalysisLock: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.lock/1">;
    plan: z.ZodString;
    cases: z.ZodArray<z.ZodObject<{
        id: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
        digest: z.ZodString;
        pool: z.ZodEnum<{
            development: "development";
            promoted: "promoted";
            sealed: "sealed";
            validation: "validation";
        }>;
        family: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    instruments: z.ZodRecord<z.core.$ZodBranded<z.ZodString, "MeasureId", "out">, z.ZodString>;
}, z.core.$strict>;
/** The plan lock. */
export type AnalysisLock = z.infer<typeof AnalysisLock>;
//# sourceMappingURL=analysis-plan.d.ts.map