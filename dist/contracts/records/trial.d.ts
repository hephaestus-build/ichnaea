import * as z from "zod";
/**
 * Outcome classes of a trial (REQ-20). A capture failure is never a verdict:
 * `infrastructure_failure` and `not_run` count as missing, never as a quality failure.
 */
export declare const Outcome: z.ZodEnum<{
    abstained: "abstained";
    budget_exceeded: "budget_exceeded";
    completed: "completed";
    infrastructure_failure: "infrastructure_failure";
    invalid_configuration: "invalid_configuration";
    not_run: "not_run";
    system_failure: "system_failure";
}>;
/** A trial outcome. */
export type Outcome = z.infer<typeof Outcome>;
/** One step inside a trial: a model call, a tool call, a retrieval or a user turn. */
export declare const Step: z.ZodObject<{
    kind: z.ZodEnum<{
        model_call: "model_call";
        other: "other";
        retrieval: "retrieval";
        tool_call: "tool_call";
        user_turn: "user_turn";
    }>;
    name: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    outcome: z.ZodOptional<z.ZodEnum<{
        error: "error";
        ok: "ok";
        refused: "refused";
        timeout: "timeout";
    }>>;
    inputTokens: z.ZodOptional<z.ZodInt>;
    outputTokens: z.ZodOptional<z.ZodInt>;
    durationMs: z.ZodOptional<z.ZodNumber>;
    detail: z.ZodOptional<z.ZodJSONSchema>;
}, z.core.$strict>;
/** Resource usage of a trial as reported. Absent means unknown, never zero. */
export declare const Usage: z.ZodObject<{
    calls: z.ZodOptional<z.ZodInt>;
    inputTokens: z.ZodOptional<z.ZodInt>;
    outputTokens: z.ZodOptional<z.ZodInt>;
    cost: z.ZodOptional<z.ZodNumber>;
    costUnit: z.ZodOptional<z.ZodString>;
    wallMs: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
/**
 * An observed factor value reported by the system for this trial, for example the model identity
 * a provider returned or a provider fingerprint (informational, never part of the identity).
 */
export declare const Observation: z.ZodObject<{
    name: z.ZodString;
    value: z.ZodJSONSchema;
    expected: z.ZodOptional<z.ZodJSONSchema>;
}, z.core.$strict>;
/** The normalised evidence of one trial or one sampled production interaction (REQ-19, REQ-20). */
export declare const Trial: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.trial/1">;
    id: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
    source: z.ZodEnum<{
        offline: "offline";
        online: "online";
    }>;
    run: z.ZodOptional<z.core.$ZodBranded<z.ZodString, "RunId", "out">>;
    case: z.ZodNullable<z.core.$ZodBranded<z.ZodString, "CaseId", "out">>;
    caseDigest: z.ZodOptional<z.ZodString>;
    unit: z.ZodEnum<{
        episode: "episode";
        session: "session";
        trace: "trace";
        turn: "turn";
    }>;
    configuration: z.core.$ZodBranded<z.ZodString, "ConfigurationIdentity", "out">;
    arm: z.ZodOptional<z.core.$ZodBranded<z.ZodString, "ArmName", "out">>;
    replicate: z.ZodInt;
    outcome: z.ZodEnum<{
        abstained: "abstained";
        budget_exceeded: "budget_exceeded";
        completed: "completed";
        infrastructure_failure: "infrastructure_failure";
        invalid_configuration: "invalid_configuration";
        not_run: "not_run";
        system_failure: "system_failure";
    }>;
    dataClass: z.ZodEnum<{
        none: "none";
        personal: "personal";
        pseudonymous: "pseudonymous";
        special: "special";
    }>;
    input: z.ZodOptional<z.ZodJSONSchema>;
    output: z.ZodOptional<z.ZodJSONSchema>;
    pointer: z.ZodOptional<z.ZodString>;
    steps: z.ZodOptional<z.ZodArray<z.ZodObject<{
        kind: z.ZodEnum<{
            model_call: "model_call";
            other: "other";
            retrieval: "retrieval";
            tool_call: "tool_call";
            user_turn: "user_turn";
        }>;
        name: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        outcome: z.ZodOptional<z.ZodEnum<{
            error: "error";
            ok: "ok";
            refused: "refused";
            timeout: "timeout";
        }>>;
        inputTokens: z.ZodOptional<z.ZodInt>;
        outputTokens: z.ZodOptional<z.ZodInt>;
        durationMs: z.ZodOptional<z.ZodNumber>;
        detail: z.ZodOptional<z.ZodJSONSchema>;
    }, z.core.$strict>>>;
    usage: z.ZodOptional<z.ZodObject<{
        calls: z.ZodOptional<z.ZodInt>;
        inputTokens: z.ZodOptional<z.ZodInt>;
        outputTokens: z.ZodOptional<z.ZodInt>;
        cost: z.ZodOptional<z.ZodNumber>;
        costUnit: z.ZodOptional<z.ZodString>;
        wallMs: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    observed: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        value: z.ZodJSONSchema;
        expected: z.ZodOptional<z.ZodJSONSchema>;
    }, z.core.$strict>>>;
    signals: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
    cache: z.ZodOptional<z.ZodObject<{
        hit: z.ZodBoolean;
        from: z.ZodOptional<z.core.$ZodBranded<z.ZodString, "TrialId", "out">>;
    }, z.core.$strict>>;
    evidence: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        digest: z.ZodString;
        uri: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>>;
    joinKeys: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    error: z.ZodOptional<z.ZodObject<{
        kind: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    startedAt: z.ZodOptional<z.ZodISODateTime>;
    endedAt: z.ZodOptional<z.ZodISODateTime>;
    inputDigest: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/** A trial record. */
export type Trial = z.infer<typeof Trial>;
//# sourceMappingURL=trial.d.ts.map