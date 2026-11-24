import * as z from "zod";
/** A decision result when a run supports a verdict. */
export declare const Verdict: z.ZodEnum<{
    INCONCLUSIVE: "INCONCLUSIVE";
    INVALID: "INVALID";
    PASS: "PASS";
    REGRESSION: "REGRESSION";
}>;
export declare const RunPurpose: z.ZodEnum<{
    confirmation: "confirmation";
    development: "development";
    regression: "regression";
}>;
export declare const Registration: z.ZodEnum<{
    exploratory: "exploratory";
    registered: "registered";
    unregistered: "unregistered";
}>;
export declare const CandidateHistory: z.ZodObject<{
    scope: z.ZodEnum<{
        records: "records";
        store: "store";
    }>;
    candidates: z.ZodArray<z.ZodObject<{
        run: z.core.$ZodBranded<z.ZodString, "RunId", "out">;
        candidate: z.core.$ZodBranded<z.ZodString, "ConfigurationIdentity", "out">;
        verdict: z.ZodNullable<z.ZodEnum<{
            INCONCLUSIVE: "INCONCLUSIVE";
            INVALID: "INVALID";
            PASS: "PASS";
            REGRESSION: "REGRESSION";
        }>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const RunFailure: z.ZodEnum<{
    "budget-exceeded": "budget-exceeded";
    protocol: "protocol";
    "worker-closed": "worker-closed";
    "worker-unresponsive": "worker-unresponsive";
}>;
//# sourceMappingURL=run-registration.d.ts.map