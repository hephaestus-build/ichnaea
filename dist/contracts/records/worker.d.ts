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
 * arm's planned configuration and refuses the trial on any difference.
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
}, z.core.$strict>;
/** An observed configuration. */
export type ObservedConfiguration = z.infer<typeof ObservedConfiguration>;
/**
 * What a worker answers for one trial request: one JSON line on its standard output, in request
 * order. For a request line it cannot read, the worker writes an `ichnaea.workerError/1` line in
 * that place instead, and Ichnaea stops the run there, so that line needs no trial identity. It
 * carries the raw output, never a score or a verdict, because the base suite's scorers read the
 * output later (REQ-22). It carries no times: Ichnaea measures `startedAt` and `endedAt`
 * itself: a writer never sends them, and a reader ignores them as unknown members. The same record is the row that
 * `importResults` takes for results that already exist. A result without `failure` and with neither
 * `output` nor `pointer` is recorded as an infrastructure failure of kind `NOT_CAPTURED`, as import
 * records any completed trial without captured output: a capture failure is never a quality verdict.
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
    calls: z.ZodInt;
    usage: z.ZodOptional<z.ZodObject<{
        calls: z.ZodOptional<z.ZodInt>;
        inputTokens: z.ZodOptional<z.ZodInt>;
        outputTokens: z.ZodOptional<z.ZodInt>;
        cost: z.ZodOptional<z.ZodNumber>;
        costUnit: z.ZodOptional<z.ZodString>;
        wallMs: z.ZodOptional<z.ZodNumber>;
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
    }, z.core.$strict>;
}, z.core.$strict>;
/** A trial result. */
export type TrialResult = z.infer<typeof TrialResult>;
/**
 * What a worker writes for a request line it cannot read, for example a line that is not JSON or
 * not a trial request. It never guesses a trial identity: a guess would attach the error to the
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
//# sourceMappingURL=worker.d.ts.map