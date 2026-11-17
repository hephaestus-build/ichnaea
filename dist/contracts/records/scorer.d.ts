import * as z from "zod";
/**
 * One trial to score: its delivered output, a writable copy of its artifacts and its stage events.
 */
export declare const ScoreUnit: z.ZodObject<{
    trial: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
    output: z.ZodOptional<z.ZodJSONSchema>;
    artifacts: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        path: z.ZodString;
    }, z.core.$strict>>>;
    events: z.ZodOptional<z.ZodArray<z.ZodObject<{
        stage: z.ZodString;
        iteration: z.ZodInt;
        ran: z.ZodBoolean;
        output: z.ZodOptional<z.ZodJSONSchema>;
        artifact: z.ZodOptional<z.ZodString>;
        replayed: z.ZodOptional<z.ZodString>;
        startedAt: z.ZodOptional<z.ZodISODateTime>;
        endedAt: z.ZodOptional<z.ZodISODateTime>;
        stop: z.ZodOptional<z.ZodObject<{
            reason: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>>;
}, z.core.$strict>;
/** A unit to score. */
export type ScoreUnit = z.infer<typeof ScoreUnit>;
/**
 * What Ichnaea sends a scorer process: one JSON line on its standard input. The scorer runs from a
 * copy of the base's pinned files, so both arms are measured the same way. One request can score
 * several measures on several trials of one case. Unlike a trial request, it carries the case's
 * references.
 */
export declare const ScoreRequest: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.scoreRequest/1">;
    id: z.core.$ZodBranded<z.ZodString, "ScoreRequestId", "out">;
    dataClass: z.ZodEnum<{
        none: "none";
        personal: "personal";
        pseudonymous: "pseudonymous";
        special: "special";
    }>;
    instrument: z.ZodString;
    deadline: z.ZodString;
    settings: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
    measures: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        dimension: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    case: z.ZodObject<{
        id: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
        input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
        references: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
    }, z.core.$strict>;
    scratch: z.ZodString;
    units: z.ZodArray<z.ZodObject<{
        trial: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
        output: z.ZodOptional<z.ZodJSONSchema>;
        artifacts: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            path: z.ZodString;
        }, z.core.$strict>>>;
        events: z.ZodOptional<z.ZodArray<z.ZodObject<{
            stage: z.ZodString;
            iteration: z.ZodInt;
            ran: z.ZodBoolean;
            output: z.ZodOptional<z.ZodJSONSchema>;
            artifact: z.ZodOptional<z.ZodString>;
            replayed: z.ZodOptional<z.ZodString>;
            startedAt: z.ZodOptional<z.ZodISODateTime>;
            endedAt: z.ZodOptional<z.ZodISODateTime>;
            stop: z.ZodOptional<z.ZodObject<{
                reason: z.ZodString;
            }, z.core.$strict>>;
        }, z.core.$strict>>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
/** A score request. */
export type ScoreRequest = z.infer<typeof ScoreRequest>;
/**
 * A raw value as a scorer gives it: a boolean for a binary measure, a number for a score, a
 * quantity or a level (one of the measure's level values, never a level's name), or a proportion of
 * items inside the trial. A number is finite: NaN and
 * the infinities are not JSON, so a scorer that computes one reports the value as missing with
 * reason `NON_FINITE`. A schema cannot compare two fields, so a proportion whose numerator exceeds
 * its denominator validates here, and Ichnaea refuses it when it reads the value.
 */
export declare const ScoredValue: z.ZodUnion<readonly [z.ZodBoolean, z.ZodNumber, z.ZodObject<{
    numerator: z.ZodInt;
    denominator: z.ZodInt;
}, z.core.$strict>]>;
/** A scored value. */
export type ScoredValue = z.infer<typeof ScoredValue>;
/** What the instrument observed while it scored: the model that answered and its responses. */
export declare const ScoreObserved: z.ZodObject<{
    model: z.ZodOptional<z.ZodString>;
    responseIds: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
/** What a scorer observed. */
export type ScoreObserved = z.infer<typeof ScoreObserved>;
/**
 * Why an instrument failed, by class:
 * - `infrastructure`: the instrument's endpoint or sandbox failed. Ichnaea retries it, then the
 *   value is missing;
 * - `protocol`: the request broke the protocol, for example kind `bad-request`. The run is INVALID.
 *
 * The worker classes `system` and `not_run` do not apply: the system's own failure is a value
 * (`ok`, `false`, with a `why`), and an instrument that cannot give a value and must not be
 * retried returns `missing`. Whoever reads a result treats any other class as a protocol failure.
 */
export declare const ScoreFailure: z.ZodObject<{
    class: z.ZodEnum<{
        infrastructure: "infrastructure";
        protocol: "protocol";
    }>;
    kind: z.ZodString;
    message: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/** A scorer failure. */
export type ScoreFailure = z.infer<typeof ScoreFailure>;
/**
 * One value for one trial and one measure, by status:
 * - `ok`: the value;
 * - `not_applicable`: the measure does not apply to the trial. It is neither a zero nor missing;
 * - `error`: the instrument failed, with class `infrastructure` (retried, then missing) or
 *   `protocol` (the run is INVALID). When the request's unit identities parse but the request is
 *   wrong, the scorer echoes each unit with class `protocol` and kind `bad-request`;
 * - `missing`: the instrument gave no value and must not be retried, with a reason, such as a
 *   judge reply that does not parse.
 *
 * A value that a scorer did not give is missing, never a zero.
 */
export declare const UnitScore: z.ZodDiscriminatedUnion<[z.ZodObject<{
    trial: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
    measure: z.ZodString;
    observed: z.ZodOptional<z.ZodObject<{
        model: z.ZodOptional<z.ZodString>;
        responseIds: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
    status: z.ZodLiteral<"ok">;
    value: z.ZodUnion<readonly [z.ZodBoolean, z.ZodNumber, z.ZodObject<{
        numerator: z.ZodInt;
        denominator: z.ZodInt;
    }, z.core.$strict>]>;
    why: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    trial: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
    measure: z.ZodString;
    observed: z.ZodOptional<z.ZodObject<{
        model: z.ZodOptional<z.ZodString>;
        responseIds: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
    status: z.ZodLiteral<"not_applicable">;
    why: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    trial: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
    measure: z.ZodString;
    observed: z.ZodOptional<z.ZodObject<{
        model: z.ZodOptional<z.ZodString>;
        responseIds: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
    status: z.ZodLiteral<"error">;
    failure: z.ZodObject<{
        class: z.ZodEnum<{
            infrastructure: "infrastructure";
            protocol: "protocol";
        }>;
        kind: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    trial: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
    measure: z.ZodString;
    observed: z.ZodOptional<z.ZodObject<{
        model: z.ZodOptional<z.ZodString>;
        responseIds: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
    status: z.ZodLiteral<"missing">;
    reason: z.ZodString;
    why: z.ZodOptional<z.ZodString>;
}, z.core.$strict>], "status">;
/** One scored unit. */
export type UnitScore = z.infer<typeof UnitScore>;
/**
 * What a scorer answers for one score request: one JSON line on its standard output, with a value
 * per trial and measure. Ichnaea matches the result to its request by `request`, and each value by
 * trial and measure, never by position. For a request line without readable unit identities, the scorer writes an
 * `ichnaea.workerError/1` line instead, and the run stops.
 */
export declare const ScoreResult: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.scoreResult/1">;
    request: z.core.$ZodBranded<z.ZodString, "ScoreRequestId", "out">;
    dataClass: z.ZodEnum<{
        none: "none";
        personal: "personal";
        pseudonymous: "pseudonymous";
        special: "special";
    }>;
    values: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        trial: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
        measure: z.ZodString;
        observed: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            responseIds: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>;
        status: z.ZodLiteral<"ok">;
        value: z.ZodUnion<readonly [z.ZodBoolean, z.ZodNumber, z.ZodObject<{
            numerator: z.ZodInt;
            denominator: z.ZodInt;
        }, z.core.$strict>]>;
        why: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        trial: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
        measure: z.ZodString;
        observed: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            responseIds: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>;
        status: z.ZodLiteral<"not_applicable">;
        why: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        trial: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
        measure: z.ZodString;
        observed: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            responseIds: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>;
        status: z.ZodLiteral<"error">;
        failure: z.ZodObject<{
            class: z.ZodEnum<{
                infrastructure: "infrastructure";
                protocol: "protocol";
            }>;
            kind: z.ZodString;
            message: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        trial: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
        measure: z.ZodString;
        observed: z.ZodOptional<z.ZodObject<{
            model: z.ZodOptional<z.ZodString>;
            responseIds: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>;
        status: z.ZodLiteral<"missing">;
        reason: z.ZodString;
        why: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>], "status">>;
}, z.core.$strict>;
/** A score result. */
export type ScoreResult = z.infer<typeof ScoreResult>;
//# sourceMappingURL=scorer.d.ts.map