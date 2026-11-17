import * as z from "zod";
/**
 * Which trial a request asks for and a result answers: the identity that resume uses. A result
 * echoes it, so Ichnaea can refuse an answer to another request.
 */
export declare const TrialIdentity: z.ZodObject<{
    id: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
    suite: z.core.$ZodBranded<z.ZodString, "SuiteId", "out">;
    case: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
    arm: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
    replicate: z.ZodInt;
    attempt: z.ZodInt;
}, z.core.$strict>;
/** The identity of one trial and one attempt at it. */
export type TrialIdentity = z.infer<typeof TrialIdentity>;
/**
 * The W3C trace context of one trial. A system that emits OpenTelemetry spans continues the trace
 * in `traceparent`, so its spans link to the trial.
 */
export declare const TraceContext: z.ZodObject<{
    traceparent: z.ZodString;
}, z.core.$strict>;
/** A trace context. */
export type TraceContext = z.infer<typeof TraceContext>;
/**
 * A frozen input for a stage that the trial starts after: the trial replays it instead of running
 * the stages before it. The worker reports the digest back on the stage's event, so Ichnaea can
 * check that the system consumed the input.
 */
export declare const Replay: z.ZodObject<{
    stage: z.ZodString;
    path: z.ZodString;
    digest: z.ZodString;
    state: z.ZodOptional<z.ZodJSONSchema>;
}, z.core.$strict>;
/** A replayed input. */
export type Replay = z.infer<typeof Replay>;
/**
 * What Ichnaea sends a worker for one trial: one JSON line on its standard input (REQ-22). The case
 * comes from the base suite, never from the worker's own root, and carries no references: the worker
 * runs the system and never scores it. The request does not say whether its arm is the base or the
 * candidate: `trial.arm` is an opaque name, so a system cannot behave differently per side.
 */
export declare const TrialRequest: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.trialRequest/1">;
    dataClass: z.ZodEnum<{
        none: "none";
        personal: "personal";
        pseudonymous: "pseudonymous";
        special: "special";
    }>;
    plan: z.core.$ZodBranded<z.ZodString, "PlanDigest", "out">;
    trial: z.ZodObject<{
        id: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
        suite: z.core.$ZodBranded<z.ZodString, "SuiteId", "out">;
        case: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
        arm: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
        replicate: z.ZodInt;
        attempt: z.ZodInt;
    }, z.core.$strict>;
    case: z.ZodObject<{
        id: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
        digest: z.ZodString;
        unit: z.ZodEnum<{
            episode: "episode";
            session: "session";
            trace: "trace";
            turn: "turn";
        }>;
        input: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
        turns: z.ZodOptional<z.ZodArray<z.ZodObject<{
            role: z.ZodEnum<{
                assistant: "assistant";
                system: "system";
                tool: "tool";
                user: "user";
            }>;
            content: z.ZodJSONSchema;
        }, z.core.$strict>>>;
        fixtures: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            digest: z.ZodString;
            uri: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>>;
    }, z.core.$strict>;
    limits: z.ZodObject<{
        calls: z.ZodOptional<z.ZodInt>;
    }, z.core.$strict>;
    deadline: z.ZodString;
    workdir: z.ZodString;
    configuration: z.ZodObject<{
        path: z.ZodString;
    }, z.core.$strict>;
    seed: z.ZodOptional<z.ZodObject<{
        algorithm: z.ZodString;
        value: z.ZodString;
    }, z.core.$strict>>;
    replay: z.ZodOptional<z.ZodObject<{
        stage: z.ZodString;
        path: z.ZodString;
        digest: z.ZodString;
        state: z.ZodOptional<z.ZodJSONSchema>;
    }, z.core.$strict>>;
    trace: z.ZodOptional<z.ZodObject<{
        traceparent: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
/** A trial request. */
export type TrialRequest = z.infer<typeof TrialRequest>;
/**
 * Why a trial produced no usable output, by class. Retries depend on the class alone:
 * - `infrastructure`: an endpoint or sandbox failure. Ichnaea retries it, and it counts as missing;
 * - `system`: the system's own failure. Ichnaea does not retry it, and the trial counts as failed;
 * - `not_run`: the worker never reached the case. Ichnaea retries it, and it counts as missing;
 * - `protocol`: the request broke the protocol, for example kind `bad-request`. That is a fault of
 *   Ichnaea or the harness, never of the system: Ichnaea does not retry it, never counts it as a
 *   pass or a failure, and makes the whole run INVALID on the first one.
 *
 * Which record a worker writes depends on whether it can read the request's `trial`. When `trial`
 * parses as a trial identity under the reader schema, so that a newer member in it does not matter,
 * the worker answers with a `protocol` failure that carries that identity, for example for a
 * missing `plan` or a limit it cannot honor. Otherwise, for a line that is not JSON, not a trial
 * request, or has no readable `trial`, it writes an `ichnaea.workerError/1` line, never a guessed
 * identity.
 */
export declare const TrialFailure: z.ZodObject<{
    class: z.ZodEnum<{
        infrastructure: "infrastructure";
        not_run: "not_run";
        protocol: "protocol";
        system: "system";
    }>;
    kind: z.ZodString;
    message: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/** A trial failure. */
export type TrialFailure = z.infer<typeof TrialFailure>;
/**
 * The trial outcome of each failure class, one to one. `protocol_failure` is the outcome of a
 * `protocol` failure and of nothing else.
 */
export declare const FAILURE_OUTCOME: {
    readonly infrastructure: "infrastructure_failure";
    readonly system: "system_failure";
    readonly not_run: "not_run";
    readonly protocol: "protocol_failure";
};
/**
 * Which code the worker ran: a git commit, an image digest, or both. A system that is not one git
 * checkout, such as an image-released service, names its image instead of inventing a commit.
 */
export declare const ObservedCode: z.ZodUnion<readonly [z.ZodObject<{
    commit: z.ZodString;
    image: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    image: z.ZodString;
    commit: z.ZodOptional<z.ZodString>;
}, z.core.$strict>]>;
/** The code a worker ran. */
export type ObservedCode = z.infer<typeof ObservedCode>;
/**
 * The configuration the worker actually ran with. Before scoring, Ichnaea compares it with the
 * arm's planned configuration and refuses the trial on any difference. It also checks that each
 * arm's processes read the configuration keys that differ between the arms, and that the
 * environment factors match across the arms unless the plan declares one changed.
 */
export declare const ObservedConfiguration: z.ZodObject<{
    code: z.ZodUnion<readonly [z.ZodObject<{
        commit: z.ZodString;
        image: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        image: z.ZodString;
        commit: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>]>;
    model: z.ZodString;
    route: z.ZodString;
    parameters: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    configuration: z.ZodString;
    configurationRead: z.ZodArray<z.ZodString>;
    environment: z.ZodRecord<z.ZodString, z.ZodString>;
    modules: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
/** An observed configuration. */
export type ObservedConfiguration = z.infer<typeof ObservedConfiguration>;
/** The system's own reason for stopping, in its own words, such as `end_turn` or `max_tokens`. */
export declare const Stop: z.ZodObject<{
    reason: z.ZodString;
}, z.core.$strict>;
/** A stop reason. */
export type Stop = z.infer<typeof Stop>;
/**
 * One raw event of a stage inside a trial. Ichnaea derives the stage's status from the events
 * through the base suite's map of stop reasons, so a worker never reports a status of its own.
 */
export declare const StageEvent: z.ZodObject<{
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
}, z.core.$strict>;
/** A stage event. */
export type StageEvent = z.infer<typeof StageEvent>;
/**
 * A file or a directory that a trial produced, inside the request's `workdir`. Ichnaea hashes and
 * stores it itself, so the worker sends no digest. An artifact over the size limit makes the trial
 * a failure of the system, not of the protocol. The worker chooses its name and path, which can
 * hold text from the case, such as a file named after the input, so both have the class of the
 * record's content.
 */
export declare const Artifact: z.ZodObject<{
    name: z.ZodString;
    path: z.ZodString;
    mediaType: z.ZodString;
    class: z.ZodOptional<z.ZodEnum<{
        none: "none";
        personal: "personal";
        pseudonymous: "pseudonymous";
        special: "special";
    }>>;
}, z.core.$strict>;
/** An artifact. */
export type Artifact = z.infer<typeof Artifact>;
/**
 * The calls that the provider rejected for its rate limit, and the time spent waiting on the
 * endpoint. A rejected call counts against neither the trial's call bound nor the run's budget.
 */
export declare const Throttling: z.ZodObject<{
    count: z.ZodInt;
    ms: z.ZodNumber;
    firstAcceptedAt: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$strict>;
/** A throttling report. */
export type Throttling = z.infer<typeof Throttling>;
/**
 * What the model calls of one trial attempt used (`usage/2`). The token counts follow the
 * OpenTelemetry `gen_ai.usage.*` attributes. An absent count is unknown, never zero.
 */
export declare const TrialUsage: z.ZodObject<{
    calls: z.ZodInt;
    inputTokens: z.ZodOptional<z.ZodInt>;
    outputTokens: z.ZodOptional<z.ZodInt>;
    cacheReadTokens: z.ZodOptional<z.ZodInt>;
    reasoningTokens: z.ZodOptional<z.ZodInt>;
    costMicros: z.ZodOptional<z.ZodInt>;
    responseIds: z.ZodArray<z.ZodString>;
    throttled: z.ZodOptional<z.ZodObject<{
        count: z.ZodInt;
        ms: z.ZodNumber;
        firstAcceptedAt: z.ZodOptional<z.ZodISODateTime>;
    }, z.core.$strict>>;
}, z.core.$strict>;
/** The usage of a trial attempt. */
export type TrialUsage = z.infer<typeof TrialUsage>;
/**
 * The times that the worker reports for a trial. Ichnaea measures when the trial started and ended
 * itself, and its own times decide. From this report it takes the first chunk. The waits on
 * throttling have one home, `usage.throttled.ms`.
 */
export declare const Timing: z.ZodObject<{
    startedAt: z.ZodISODateTime;
    firstChunkAt: z.ZodOptional<z.ZodISODateTime>;
    endedAt: z.ZodISODateTime;
}, z.core.$strict>;
/** A timing report. */
export type Timing = z.infer<typeof Timing>;
/** The traces that a trial produced. */
export declare const TrialTrace: z.ZodObject<{
    ids: z.ZodArray<z.ZodString>;
    spans: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodInt>>;
    complete: z.ZodBoolean;
}, z.core.$strict>;
/** A trial's traces. */
export type TrialTrace = z.infer<typeof TrialTrace>;
/**
 * What a worker answers for one trial request: one JSON line on its standard output. A process
 * with a capacity above 1 answers out of order, so Ichnaea matches the result to its request by
 * `trial`, never by position. For a request line it cannot read, the worker writes an
 * `ichnaea.workerError/1` line instead, and Ichnaea stops the run there, so that line needs no
 * trial identity. It carries the raw output, never a score or a verdict, because the base suite's
 * scorers read the output later (REQ-22). Ichnaea measures `startedAt` and `endedAt` itself: a
 * writer never sends them at the top level, and a reader ignores them as unknown members. The
 * worker's own times are in `timing`.
 *
 * The rules for whoever reads a result, which the runner applies:
 * - with `failure`, the trial failed. `truncated` and `output` then mean nothing and are ignored.
 *   A writer should not send them beside a failure, and the runner flags a result that does;
 * - without `failure` and with none of `output`, `pointer` and `artifacts`, the result counts as
 *   an infrastructure failure of kind `NOT_CAPTURED`, never as a failure of the system: a capture
 *   failure is never a quality verdict;
 * - without `failure` and with `truncated: true`, the output counts as missing with reason
 *   `NOT_CAPTURED`. It is never scored and never retried, because a retry would truncate again.
 *   `truncated: false` says the same as no member.
 */
export declare const TrialResult: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.trialResult/1">;
    dataClass: z.ZodEnum<{
        none: "none";
        personal: "personal";
        pseudonymous: "pseudonymous";
        special: "special";
    }>;
    trial: z.ZodObject<{
        id: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
        suite: z.core.$ZodBranded<z.ZodString, "SuiteId", "out">;
        case: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
        arm: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
        replicate: z.ZodInt;
        attempt: z.ZodInt;
    }, z.core.$strict>;
    output: z.ZodOptional<z.ZodJSONSchema>;
    pointer: z.ZodOptional<z.ZodString>;
    truncated: z.ZodOptional<z.ZodBoolean>;
    artifacts: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        path: z.ZodString;
        mediaType: z.ZodString;
        class: z.ZodOptional<z.ZodEnum<{
            none: "none";
            personal: "personal";
            pseudonymous: "pseudonymous";
            special: "special";
        }>>;
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
    failure: z.ZodOptional<z.ZodObject<{
        class: z.ZodEnum<{
            infrastructure: "infrastructure";
            not_run: "not_run";
            protocol: "protocol";
            system: "system";
        }>;
        kind: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    stop: z.ZodOptional<z.ZodObject<{
        reason: z.ZodString;
    }, z.core.$strict>>;
    usage: z.ZodObject<{
        calls: z.ZodInt;
        inputTokens: z.ZodOptional<z.ZodInt>;
        outputTokens: z.ZodOptional<z.ZodInt>;
        cacheReadTokens: z.ZodOptional<z.ZodInt>;
        reasoningTokens: z.ZodOptional<z.ZodInt>;
        costMicros: z.ZodOptional<z.ZodInt>;
        responseIds: z.ZodArray<z.ZodString>;
        throttled: z.ZodOptional<z.ZodObject<{
            count: z.ZodInt;
            ms: z.ZodNumber;
            firstAcceptedAt: z.ZodOptional<z.ZodISODateTime>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    timing: z.ZodOptional<z.ZodObject<{
        startedAt: z.ZodISODateTime;
        firstChunkAt: z.ZodOptional<z.ZodISODateTime>;
        endedAt: z.ZodISODateTime;
    }, z.core.$strict>>;
    observed: z.ZodObject<{
        code: z.ZodUnion<readonly [z.ZodObject<{
            commit: z.ZodString;
            image: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>, z.ZodObject<{
            image: z.ZodString;
            commit: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>]>;
        model: z.ZodString;
        route: z.ZodString;
        parameters: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
        configuration: z.ZodString;
        configurationRead: z.ZodArray<z.ZodString>;
        environment: z.ZodRecord<z.ZodString, z.ZodString>;
        modules: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    trace: z.ZodOptional<z.ZodObject<{
        ids: z.ZodArray<z.ZodString>;
        spans: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodInt>>;
        complete: z.ZodBoolean;
    }, z.core.$strict>>;
}, z.core.$strict>;
/** A trial result. */
export type TrialResult = z.infer<typeof TrialResult>;
/**
 * What a worker or a scorer writes for a request line it cannot read, for example a line that is
 * not JSON or not a request. It never guesses a trial identity: a guess would attach the error to the
 * wrong trial. Ichnaea makes the whole run INVALID on the first one. It is a fault of the harness or
 * of the worker's protocol handling, never of the system, and it is never counted as a pass, a
 * failure or a missing trial. Because the run stops, the error needs no trial: Ichnaea records it
 * against the run.
 */
export declare const WorkerError: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.workerError/1">;
    dataClass: z.ZodLiteral<"none">;
    kind: z.ZodString;
    message: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/** A worker error. */
export type WorkerError = z.infer<typeof WorkerError>;
/**
 * What a worker process writes on its standard output once it can take requests. Ichnaea sends no
 * request before it, and the time to start is never a trial's time. A scorer process writes the
 * same line. After it, standard output carries protocol lines only.
 */
export declare const WorkerReady: z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.workerReady/1">;
    capacity: z.ZodInt;
    protocol: z.ZodEnum<{
        "ichnaea.scoreRequest/1": "ichnaea.scoreRequest/1";
        "ichnaea.trialRequest/1": "ichnaea.trialRequest/1";
    }>;
}, z.core.$strict>;
/** A ready line. */
export type WorkerReady = z.infer<typeof WorkerReady>;
/**
 * What a worker writes about a trial in flight, before its result, by kind:
 * - `heartbeat` keeps the trial alive and reports the calls that the attempt has made so far. If
 *   Ichnaea kills an attempt, it counts the calls of the last heartbeat, or the full per-trial
 *   bound without one;
 * - `tool_call` reports one call of a tool inside a stage. Its fields map one to one onto the
 *   OpenTelemetry `execute_tool` span.
 *
 * A reader accepts a kind that a later minor version adds, with members of its own.
 */
export declare const WorkerEvent: z.ZodDiscriminatedUnion<[z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.workerEvent/1">;
    trial: z.ZodObject<{
        id: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
        suite: z.core.$ZodBranded<z.ZodString, "SuiteId", "out">;
        case: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
        arm: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
        replicate: z.ZodInt;
        attempt: z.ZodInt;
    }, z.core.$strict>;
    kind: z.ZodLiteral<"heartbeat">;
    calls: z.ZodInt;
    throttled: z.ZodOptional<z.ZodObject<{
        count: z.ZodInt;
        ms: z.ZodNumber;
        firstAcceptedAt: z.ZodOptional<z.ZodISODateTime>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.workerEvent/1">;
    dataClass: z.ZodEnum<{
        none: "none";
        personal: "personal";
        pseudonymous: "pseudonymous";
        special: "special";
    }>;
    trial: z.ZodObject<{
        id: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
        suite: z.core.$ZodBranded<z.ZodString, "SuiteId", "out">;
        case: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
        arm: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
        replicate: z.ZodInt;
        attempt: z.ZodInt;
    }, z.core.$strict>;
    kind: z.ZodLiteral<"tool_call">;
    stage: z.ZodString;
    iteration: z.ZodInt;
    turn: z.ZodOptional<z.ZodInt>;
    call: z.ZodXor<readonly [z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        args: z.ZodJSONSchema;
        error: z.ZodOptional<z.ZodString>;
        result: z.ZodOptional<z.ZodJSONSchema>;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        args: z.ZodJSONSchema;
        error: z.ZodOptional<z.ZodString>;
        resultArtifact: z.ZodString;
    }, z.core.$strict>]>;
}, z.core.$strict>], "kind">;
/** A worker event. */
export type WorkerEvent = z.infer<typeof WorkerEvent>;
/**
 * What Ichnaea sends to stop work in flight, at its deadline or on an interrupt. It names exactly
 * one of a worker's `trial` or a scorer's `request`, for the writer and the reader alike: a
 * process never guesses which of two it was asked to stop. A tolerantly read cancel may also be a
 * shape that a later minor version adds, so a consumer narrows it first with
 * `isKnownKind(cancel, "schema", ["ichnaea.cancel/1"])`, then with `"trial" in cancel`. The process tears the work down and answers
 * with its result. Without a result in the grace period, Ichnaea stops the process group, and the
 * process's other work in flight is retried on a new process.
 */
export declare const Cancel: z.ZodXor<readonly [z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.cancel/1">;
    trial: z.ZodObject<{
        id: z.core.$ZodBranded<z.ZodString, "TrialId", "out">;
        suite: z.core.$ZodBranded<z.ZodString, "SuiteId", "out">;
        case: z.core.$ZodBranded<z.ZodString, "CaseId", "out">;
        arm: z.core.$ZodBranded<z.ZodString, "ArmName", "out">;
        replicate: z.ZodInt;
        attempt: z.ZodInt;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    schema: z.ZodLiteral<"ichnaea.cancel/1">;
    request: z.core.$ZodBranded<z.ZodString, "ScoreRequestId", "out">;
}, z.core.$strict>]>;
/** A cancel line. */
export type Cancel = z.infer<typeof Cancel>;
//# sourceMappingURL=worker.d.ts.map