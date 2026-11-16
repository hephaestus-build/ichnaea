import * as z from "zod";
/**
 * An online or scheduled check (REQ-60). An alert without an owner and an action is a dashboard
 * series, so both are required. The owner may be a person, so it is classed personal.
 */
export declare const Monitor: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.monitor/1">;
    id: z.core.$ZodBranded<z.ZodString, "MonitorId", "out">;
    measure: z.core.$ZodBranded<z.ZodString, "MeasureId", "out">;
    strata: z.ZodOptional<z.ZodArray<z.ZodString>>;
    sampling: z.ZodEnum<{
        census: "census";
        random: "random";
        triage: "triage";
    }>;
    statistic: z.ZodEnum<{
        "age-threshold": "age-threshold";
        "bernoulli-cusum": "bernoulli-cusum";
        "confidence-sequence": "confidence-sequence";
        "poisson-cusum": "poisson-cusum";
    }>;
    parameters: z.ZodRecord<z.ZodString, z.ZodNumber>;
    reference: z.ZodNumber;
    falseAlarmsPerYear: z.ZodNumber;
    practicalMargin: z.ZodNumber;
    owner: z.ZodString;
    action: z.ZodString;
    severity: z.ZodEnum<{
        critical: "critical";
        info: "info";
        warning: "warning";
    }>;
}, z.core.$strict>;
/** A monitor. */
export type Monitor = z.infer<typeof Monitor>;
/** A confirmed failure with pointers to its trial records (REQ-70, REQ-71). */
export declare const Finding: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.finding/1">;
    id: z.core.$ZodBranded<z.ZodString, "FindingId", "out">;
    source: z.ZodEnum<{
        canary: "canary";
        check: "check";
        manual: "manual";
        monitor: "monitor";
        triage: "triage";
    }>;
    trials: z.ZodArray<z.core.$ZodBranded<z.ZodString, "TrialId", "out">>;
    pointers: z.ZodArray<z.ZodString>;
    failureClass: z.ZodString;
    confirmedAt: z.ZodOptional<z.ZodISODateTime>;
    confirmerRole: z.ZodOptional<z.ZodString>;
    promotion: z.ZodEnum<{
        consented: "consented";
        none: "none";
        rejected: "rejected";
        synthetic: "synthetic";
    }>;
    linkedCase: z.ZodOptional<z.core.$ZodBranded<z.ZodString, "CaseId", "out">>;
    action: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/** A finding. */
export type Finding = z.infer<typeof Finding>;
//# sourceMappingURL=monitor.d.ts.map