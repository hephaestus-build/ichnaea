import * as z from "zod";
import { attribute, content, none, quasi } from "../data-class.js";
import { ArmName, CaseId, Digest, DigestRef, Duration, Json, PlanDigest, RecordDataClass, ScoreRequestId, Seed, SuiteId, Text, Timestamp, TrialId, Unit, } from "../primitives.js";
import { ScriptedTurn } from "./case.js";
import {} from "./trial.js";
/**
 * Which trial a request asks for and a result answers: the identity that resume uses. A result
 * echoes it, so Ichnaea can refuse an answer to another request.
 */
export const TrialIdentity = z.strictObject({
    /** The trial's ID in the plan. */
    id: none(TrialId),
    /** The suite the trial belongs to. */
    suite: none(SuiteId),
    /** The case the trial runs. */
    case: none(CaseId),
    /**
     * The arm the trial runs under, as an opaque name. Ichnaea assigns arm names that do not reveal
     * which arm is the base and which the candidate, so the name never tells a system its side.
     */
    arm: none(ArmName),
    /** The replicate of the case under the arm, from 0. */
    replicate: none(z.int().min(0)),
    /** The attempt at this trial, from 1. A retry after an infrastructure failure is the next one. */
    attempt: none(z.int().min(1)),
});
/**
 * The W3C trace context of one trial. A system that emits OpenTelemetry spans continues the trace
 * in `traceparent`, so its spans link to the trial.
 */
export const TraceContext = z.strictObject({
    /** The W3C `traceparent` header value of the trial, version `00`. */
    traceparent: none(z.string().regex(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/)),
});
/**
 * A frozen input for a stage that the trial starts after: the trial replays it instead of running
 * the stages before it. The worker reports the digest back on the stage's event, so Ichnaea can
 * check that the system consumed the input.
 */
export const Replay = z.strictObject({
    /** The stage whose frozen output the trial starts from. */
    stage: none(Text),
    /** A read-only copy of the frozen input. */
    path: none(Text),
    /** The digest of the frozen input. */
    digest: none(Digest),
    /** What the next stage needs beside the input, such as a remaining budget. */
    state: content(Json).optional(),
});
/**
 * What Ichnaea sends a worker for one trial: one JSON line on its standard input (REQ-22). The case
 * comes from the base suite, never from the worker's own root, and carries no references: the worker
 * runs the system and never scores it. The request does not say whether its arm is the base or the
 * candidate: `trial.arm` is an opaque name, so a system cannot behave differently per side.
 */
export const TrialRequest = z.strictObject({
    schema: none(z.literal("ichnaea.trialRequest/1")),
    /** The data class of the request's content: the case's. */
    dataClass: none(RecordDataClass),
    /** The digest of the locked plan that the trial belongs to. */
    plan: none(PlanDigest),
    /** The trial and the attempt asked for. */
    trial: TrialIdentity,
    /** What the system needs of the case: its input, turns and fixtures, never its references. */
    case: z.strictObject({
        /** The case's ID. */
        id: none(CaseId),
        /** The digest of the case record in the base suite, so the answer is bound to that case. */
        digest: none(Digest),
        /** What the case is a unit of. */
        unit: none(Unit),
        /** The case's input, as the base suite's cases hold it. */
        input: content(z.record(z.string(), Json)),
        /** Scripted turns for a multi-turn case. */
        turns: z.array(ScriptedTurn).optional(),
        /** Fixtures the case needs, by digest. */
        fixtures: z.array(DigestRef).optional(),
    }),
    /** Bounds for this trial. */
    limits: z.strictObject({
        /**
         * The most model calls the trial may make, counted as calls the provider accepted. The worker
         * stops before it exceeds them, and Ichnaea also checks `usage.calls` in the result against
         * them. Absent means no per-trial bound. A call the provider rejected, for example with HTTP
         * 429, is not a call.
         */
        calls: none(z
            .int()
            .min(0)
            .describe("The most model calls the trial may make, counted as calls the provider accepted. A call the provider rejected, for example with HTTP 429, is not a call.")).optional(),
    }),
    /**
     * The plan's time limit for the trial, net of throttle waits. At the limit, Ichnaea sends a
     * `cancel`, and the trial is a system timeout.
     */
    deadline: none(Duration),
    /** A writable directory for this trial. Every artifact that the result names lies inside it. */
    workdir: none(Text),
    /**
     * The arm's configuration file. Its path never says whether the arm is the base or the
     * candidate.
     */
    configuration: z.strictObject({
        /** The path of the configuration file, which the worker reads. */
        path: none(Text),
    }),
    /**
     * The seed for an instrument that simulates the user, the same for the case and replicate in
     * both arms. The worker passes it only to that instrument: the system never receives it.
     */
    seed: Seed.optional(),
    /** The frozen input of a stage suite, when the trial starts after a stage. */
    replay: Replay.optional(),
    /** The trial's trace context. The worker process also gets it as `TRACEPARENT`. */
    trace: TraceContext.optional(),
});
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
export const TrialFailure = z.strictObject({
    /** The failure's class. */
    class: none(z.enum(["infrastructure", "system", "not_run", "protocol"])),
    /** A short, stable kind, such as `timeout`, `rate-limited` or `bad-request`. */
    kind: none(Text),
    /** A human-readable message. It may contain content from the system. */
    message: content(z.string()).optional(),
});
/**
 * The trial outcome of each failure class, one to one. `protocol_failure` is the outcome of a
 * `protocol` failure and of nothing else.
 */
export const FAILURE_OUTCOME = {
    infrastructure: "infrastructure_failure",
    system: "system_failure",
    not_run: "not_run",
    protocol: "protocol_failure",
};
/** The commit of the system's code, as 40 hexadecimal characters. */
const Commit = none(z.string().regex(/^[0-9a-f]{40}$/));
/**
 * Which code the worker ran: a git commit, an image digest, or both. A system that is not one git
 * checkout, such as an image-released service, names its image instead of inventing a commit.
 */
export const ObservedCode = z.union([
    z.strictObject({
        /** The commit of the system's code. */
        commit: Commit,
        /** The digest of the image that ran the code, when there is one. */
        image: none(Digest).optional(),
    }),
    z.strictObject({
        /** The digest of the image that ran the code. */
        image: none(Digest),
        /**
         * A commit, when there is one. It is constrained here too: a reader ignores unknown members, so
         * an unconstrained `commit` would let a reader accept a short commit that a writer refuses.
         */
        commit: Commit.optional(),
    }),
]);
/**
 * The configuration the worker actually ran with. Before scoring, Ichnaea compares it with the
 * arm's planned configuration and refuses the trial on any difference. It also checks that each
 * arm's processes read the configuration keys that differ between the arms, and that the
 * environment factors match across the arms unless the plan declares one changed.
 */
export const ObservedConfiguration = z.strictObject({
    /** The code that ran: a git commit, an image digest, or both. */
    code: ObservedCode,
    /** The model identity the system called. */
    model: none(Text),
    /** The digest of the endpoint route, never its URL. */
    route: none(Digest),
    /** The generation parameters the system used. */
    parameters: none(z.record(z.string(), Json)),
    /** The digest of the configuration file that the worker read. */
    configuration: none(Digest),
    /**
     * The configuration keys that the worker process has read since it started. A process that
     * builds its pipeline once still reports the keys it read then.
     */
    configurationRead: none(z.array(Text)),
    /**
     * The identity of each service factor that the system read, by factor name, such as the
     * snapshot ID of a search index. Ichnaea computes the digest of a path factor itself. The
     * system reports the identities, so they have the class of the record's content.
     */
    environment: attribute(z.record(Text, Text)),
    /**
     * The code files that the process loaded from outside its arm's directory, or its entry path,
     * so that Ichnaea can check that an arm ran only its own code. The paths are the worker's, so
     * they have the class of the record's content.
     */
    modules: attribute(z.array(Text)).optional(),
});
/** The system's own reason for stopping, in its own words, such as `end_turn` or `max_tokens`. */
export const Stop = z.strictObject({
    /**
     * The raw stop reason. The base suite maps it to a class, so the system never sends one: an
     * unmapped reason counts as a failure of the system and is flagged.
     */
    reason: none(Text),
});
/**
 * One raw event of a stage inside a trial. Ichnaea derives the stage's status from the events
 * through the base suite's map of stop reasons, so a worker never reports a status of its own.
 */
export const StageEvent = z.strictObject({
    /** The stage's name, as the suite lists it. */
    stage: none(Text),
    /** Which run of the stage within the trial, from 0. */
    iteration: none(z.int().min(0)),
    /** Whether the stage ran in this iteration. */
    ran: none(z.boolean()),
    /** What the stage produced. */
    output: content(Json).optional(),
    /**
     * The name of the entry in `artifacts` that holds what the stage produced. The worker chooses
     * it, so it has the class of the record's content.
     */
    artifact: attribute(Text).optional(),
    /** The digest of the frozen input that the stage consumed, on a replayed stage. */
    replayed: none(Digest).optional(),
    /** When the stage started, as the system reports it. */
    startedAt: none(Timestamp).optional(),
    /** When the stage ended, as the system reports it. */
    endedAt: none(Timestamp).optional(),
    /** Why the stage stopped. */
    stop: Stop.optional(),
});
/**
 * A file or a directory that a trial produced, inside the request's `workdir`. Ichnaea hashes and
 * stores it itself, so the worker sends no digest. An artifact over the size limit makes the trial
 * a failure of the system, not of the protocol. The worker chooses its name and path, which can
 * hold text from the case, such as a file named after the input, so both have the class of the
 * record's content.
 */
export const Artifact = z.strictObject({
    /** The artifact's name, unique within the result. */
    name: attribute(Text),
    /** Where the artifact is, inside `workdir`. */
    path: attribute(Text),
    /** The media type, such as `application/json`, or `inode/directory` for a directory. */
    mediaType: none(z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}$/)),
    /**
     * The data class that the worker declares for the content. It can only raise the class that
     * Ichnaea derives, never lower it.
     */
    class: none(RecordDataClass).optional(),
});
/**
 * The calls that the provider rejected for its rate limit, and the time spent waiting on the
 * endpoint. A rejected call counts against neither the trial's call bound nor the run's budget.
 */
export const Throttling = z.strictObject({
    /** The calls that the provider rejected for its rate limit. */
    count: none(z.int().min(0)),
    /**
     * The milliseconds spent waiting before calls: holds under the endpoint's budget and back-offs.
     * The time limit does not count them.
     */
    ms: none(z.number().min(0)),
    /**
     * When the trial's first accepted call started. Ichnaea accepts it only between the request and
     * the result that it measured itself.
     */
    firstAcceptedAt: none(Timestamp).optional(),
});
/**
 * What the model calls of one trial attempt used (`usage/2`). The token counts follow the
 * OpenTelemetry `gen_ai.usage.*` attributes. An absent count is unknown, never zero.
 */
export const TrialUsage = z.strictObject({
    /** The accepted model calls of the attempt. A call that the provider rejected is not one. */
    calls: none(z
        .int()
        .min(0)
        .describe("The model calls the provider accepted in this attempt. A call the provider rejected, for example with HTTP 429, is not a call.")),
    /** The input tokens. */
    inputTokens: none(z.int().min(0)).optional(),
    /** The output tokens. */
    outputTokens: none(z.int().min(0)).optional(),
    /** The input tokens read from the provider's prompt cache. */
    cacheReadTokens: none(z.int().min(0)).optional(),
    /** The reasoning tokens. */
    reasoningTokens: none(z.int().min(0)).optional(),
    /**
     * The cost that the provider reported, in millionths of a US dollar, and nothing else. A
     * comparison prices the calls itself from one pinned price table at analysis time, so this cost
     * is only shown beside it.
     */
    costMicros: none(z.int().min(0)).optional(),
    /**
     * The provider's response ID of every call that returned one. Two arms that share a response ID
     * did not make independent calls. An ID can fetch the response from the provider, so it has the
     * class of the record's content.
     */
    responseIds: attribute(z.array(Text)),
    /** The calls that the provider rejected for its rate limit, and the waits. */
    throttled: Throttling.optional(),
});
/**
 * The times that the worker reports for a trial. Ichnaea measures when the trial started and ended
 * itself, and its own times decide. From this report it takes the first chunk. The waits on
 * throttling have one home, `usage.throttled.ms`.
 */
export const Timing = z.strictObject({
    /** When the system started the trial. */
    startedAt: none(Timestamp),
    /** When the system received the first chunk of its answer. */
    firstChunkAt: none(Timestamp).optional(),
    /** When the system ended the trial. */
    endedAt: none(Timestamp),
});
/** A W3C trace ID: 32 lowercase hexadecimal digits. */
const TraceId = z.string().regex(/^[0-9a-f]{32}$/);
/** The traces that a trial produced. */
export const TrialTrace = z.strictObject({
    /**
     * Every trace ID that the trial produced: the trial's own when the system continued its trace
     * context, or the system's own, such as one per turn of a chat behind a socket.
     */
    ids: none(z.array(TraceId).min(1)),
    /**
     * The spans that the system's SDK ended in each trace, by a trace ID in `ids`, one count per
     * trace. A trace without a count falls back to the stage map's rule for a complete trace. A
     * schema cannot check that a key is in `ids`, so whoever reads the result checks it.
     */
    spans: none(z.record(TraceId, z.int().min(0))).optional(),
    /** Whether the system reports that it ended and exported every span of those traces. */
    complete: none(z.boolean()),
});
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
export const TrialResult = z.strictObject({
    schema: none(z.literal("ichnaea.trialResult/1")),
    /** The data class of the result's content: at least the case's. */
    dataClass: none(RecordDataClass),
    /** The identity of the request this answers. */
    trial: TrialIdentity,
    /** The system's raw output, any JSON. Absent when the trial failed or the output is behind `pointer`. */
    output: content(Json).optional(),
    /** A trace or object ID where the output can be fetched, for outputs too large or private to inline. */
    pointer: quasi(Text).optional(),
    /**
     * True when the worker knows that it truncated the output. `false` says the same as no member.
     * A truncated output counts as missing, and is never scored and never retried. Beside
     * `failure`, it means nothing.
     */
    truncated: none(z.boolean()).optional(),
    /** Files and directories that the trial produced, inside the request's `workdir`. */
    artifacts: z.array(Artifact).optional(),
    /** The raw events of the system's stages, in the order they happened. */
    events: z.array(StageEvent).optional(),
    /** Why the trial produced no usable output. Absent when the trial completed. */
    failure: TrialFailure.optional(),
    /**
     * Why the system stopped, on a delivered result. It is apart from `failure`: the base suite's
     * map gives the reason its class.
     */
    stop: Stop.optional(),
    /**
     * The calls of the attempt and what they used. Required, on a failure too: `usage.calls` is the
     * one count of the trial's calls, which the trial's call bound and the run's budget sum. An
     * absent token count inside it is unknown, never zero.
     */
    usage: TrialUsage,
    /** The times that the worker reports. Absent means unknown, never zero. */
    timing: Timing.optional(),
    /** The configuration the worker ran with. */
    observed: ObservedConfiguration,
    /** The traces that the trial produced. */
    trace: TrialTrace.optional(),
});
/**
 * What a worker or a scorer writes for a request line it cannot read, for example a line that is
 * not JSON or not a request. It never guesses a trial identity: a guess would attach the error to the
 * wrong trial. Ichnaea makes the whole run INVALID on the first one. It is a fault of the harness or
 * of the worker's protocol handling, never of the system, and it is never counted as a pass, a
 * failure or a missing trial. Because the run stops, the error needs no trial: Ichnaea records it
 * against the run.
 */
export const WorkerError = z.strictObject({
    schema: none(z.literal("ichnaea.workerError/1")),
    /**
     * Always `none`: a worker error carries no content. A worker that cannot read a line cannot know
     * its data class either, so it never quotes the line.
     */
    dataClass: none(z.literal("none")),
    /** A short, stable kind, such as `bad-json` or `not-a-request`. */
    kind: none(Text),
    /**
     * What was wrong, in the worker's own words, such as "line 3: not JSON at column 41". It never
     * quotes the line, so a worker never passes a JSON parser's error text through: that text often
     * quotes the input.
     */
    message: none(Text).optional(),
});
/**
 * What a worker process writes on its standard output once it can take requests. Ichnaea sends no
 * request before it, and the time to start is never a trial's time. A scorer process writes the
 * same line. After it, standard output carries protocol lines only.
 */
export const WorkerReady = z.strictObject({
    schema: none(z.literal("ichnaea.workerReady/1")),
    /** The most requests that the process serves at once. Ichnaea never sends more. */
    capacity: none(z.int().min(1)),
    /**
     * The requests that the process reads, by their schema ID: trial requests for a worker, score
     * requests for a scorer. Ichnaea refuses a process that reads another kind.
     */
    protocol: none(z.enum(["ichnaea.trialRequest/1", "ichnaea.scoreRequest/1"])),
});
/** The members that every tool call has, wherever its result is. */
const toolCall = {
    /** The call's ID, as the model gave it. */
    id: none(Text),
    /** The tool's name. */
    name: none(Text),
    /** The arguments, as canonical JSON. */
    args: content(Json),
    /** The tool's error, in its own words. */
    error: content(z.string()).optional(),
};
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
export const WorkerEvent = z.discriminatedUnion("kind", [
    z.strictObject({
        schema: none(z.literal("ichnaea.workerEvent/1")),
        /** The trial that the event is about. */
        trial: TrialIdentity,
        kind: none(z.literal("heartbeat")),
        /** The accepted model calls of the attempt so far. */
        calls: none(z
            .int()
            .min(0)
            .describe("The model calls the provider accepted in this attempt so far. A call the provider rejected, for example with HTTP 429, is not a call.")),
        /** The calls that the provider rejected for its rate limit so far, and the waits. */
        throttled: Throttling.optional(),
    }),
    z.strictObject({
        schema: none(z.literal("ichnaea.workerEvent/1")),
        /**
         * The data class of the call's content: the arguments, the result and the error. It is at
         * least the case's and at least `pseudonymous`, unless the suite maps the tool's name to a
         * declared environment factor of class `none`.
         */
        dataClass: none(RecordDataClass),
        /** The trial that the event is about. */
        trial: TrialIdentity,
        kind: none(z.literal("tool_call")),
        /** The stage that made the call, as the suite lists it. */
        stage: none(Text),
        /** Which run of the stage within the trial, from 0. */
        iteration: none(z.int().min(0)),
        /** The turn of a session case that made the call, from 0. */
        turn: none(z.int().min(0)).optional(),
        /**
         * The tool call. Its result is either inline in `result` or, when it is too large to inline,
         * in the artifact that `resultArtifact` names, never both.
         */
        call: z.xor([
            z.strictObject({
                ...toolCall,
                /** What the tool returned, as it returned it. */
                result: content(Json).optional(),
            }),
            z.strictObject({
                ...toolCall,
                /**
                 * The name of the entry in the trial result's `artifacts` that holds the tool's result,
                 * for a result too large to inline. Ichnaea hashes the artifact: the worker sends no
                 * digest. The worker chooses the name, so it has the class of the record's content.
                 */
                resultArtifact: attribute(Text),
            }),
        ]),
    }),
]);
/**
 * What Ichnaea sends to stop work in flight, at its deadline or on an interrupt. It names exactly
 * one of a worker's `trial` or a scorer's `request`, for the writer and the reader alike: a
 * process never guesses which of two it was asked to stop. A tolerantly read cancel may also be a
 * shape that a later minor version adds, so a consumer narrows it first with
 * `isKnownKind(cancel, "schema", ["ichnaea.cancel/1"])`, then with `"trial" in cancel`. The process tears the work down and answers
 * with its result. Without a result in the grace period, Ichnaea stops the process group, and the
 * process's other work in flight is retried on a new process.
 */
export const Cancel = z.xor([
    z.strictObject({
        schema: none(z.literal("ichnaea.cancel/1")),
        /** The worker's trial to stop. */
        trial: TrialIdentity,
    }),
    z.strictObject({
        schema: none(z.literal("ichnaea.cancel/1")),
        /** The `id` of the scorer's request to stop. */
        request: none(ScoreRequestId),
    }),
]);
//# sourceMappingURL=worker.js.map