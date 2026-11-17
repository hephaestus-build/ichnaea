import * as z from "zod";

import { content, none, quasi } from "../data-class.ts";
import {
  ArmName,
  CaseId,
  Digest,
  DigestRef,
  Json,
  PlanDigest,
  RecordDataClass,
  SuiteId,
  Text,
  TrialId,
  Unit,
} from "../primitives.ts";
import { ScriptedTurn } from "./case.ts";
import { type Outcome, Usage } from "./trial.ts";

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
/** The identity of one trial and one attempt at it. */
export type TrialIdentity = z.infer<typeof TrialIdentity>;

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
     * stops before it exceeds them, and Ichnaea also checks `calls` in the result against them.
     * Absent means no per-trial bound. A call the provider rejected, for example with HTTP 429, is not a call.
     */
    calls: none(
      z
        .int()
        .min(0)
        .describe(
          "The most model calls the trial may make, counted as calls the provider accepted. A call the provider rejected, for example with HTTP 429, is not a call.",
        ),
    ).optional(),
  }),
});
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
export const TrialFailure = z.strictObject({
  /** The failure's class. */
  class: none(z.enum(["infrastructure", "system", "not_run", "protocol"])),
  /** A short, stable kind, such as `timeout`, `rate-limited` or `bad-request`. */
  kind: none(Text),
  /** A human-readable message. It may contain content from the system. */
  message: content(z.string()).optional(),
});
/** A trial failure. */
export type TrialFailure = z.infer<typeof TrialFailure>;

/**
 * The trial outcome of each failure class, one to one. `protocol_failure` is the outcome of a
 * `protocol` failure and of nothing else.
 */
export const FAILURE_OUTCOME = {
  infrastructure: "infrastructure_failure",
  system: "system_failure",
  not_run: "not_run",
  protocol: "protocol_failure",
} as const satisfies Record<TrialFailure["class"], Outcome>;

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
/** The code a worker ran. */
export type ObservedCode = z.infer<typeof ObservedCode>;

/**
 * The configuration the worker actually ran with. Before scoring, Ichnaea compares it with the
 * arm's planned configuration and refuses the trial on any difference.
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
});
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
  /** Why the trial produced no usable output. Absent when the trial completed. */
  failure: TrialFailure.optional(),
  /**
   * The model calls the provider accepted in this trial. Required: the run's call bound and budget
   * sum it. A call the provider rejected, for example with HTTP 429, is not a call.
   */
  calls: none(
    z
      .int()
      .min(0)
      .describe(
        "The model calls the provider accepted in this trial; the run's call bound and budget sum them. A call the provider rejected, for example with HTTP 429, is not a call.",
      ),
  ),
  /** Token and cost usage, when the worker knows it. Absent means unknown, never zero. */
  usage: Usage.optional(),
  /** The configuration the worker ran with. */
  observed: ObservedConfiguration,
});
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
/** A worker error. */
export type WorkerError = z.infer<typeof WorkerError>;
