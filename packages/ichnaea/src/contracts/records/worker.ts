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
  /** The arm the trial runs under. */
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
 * runs the system and never scores it.
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
  /** The arm, for information: the arm's root and configuration are the worker's own. */
  arm: z.strictObject({
    /** The arm's name in the plan. */
    name: none(ArmName),
    /** The arm's role. */
    role: none(z.enum(["base", "candidate"])),
  }),
  /** Bounds for this trial. */
  limits: z.strictObject({
    /**
     * The most model calls the trial may make. The worker stops before it exceeds them, and
     * Ichnaea also checks `calls` in the result against them. Absent means no per-trial bound.
     */
    calls: none(z.int().min(0)).optional(),
  }),
});
/** A trial request. */
export type TrialRequest = z.infer<typeof TrialRequest>;

/**
 * Why a trial produced no usable output, by class. Retries depend on the class alone:
 * - `infrastructure`: an endpoint or sandbox failure. Ichnaea retries it, and it counts as missing;
 * - `system`: the system's own failure. Ichnaea does not retry it, and the trial counts as failed;
 * - `not_run`: the worker never reached the case. Ichnaea retries it, and it counts as missing.
 *
 * A malformed request is answered with class `system` and kind `bad-request`, never with a guess.
 */
export const TrialFailure = z.strictObject({
  /** The failure's class. */
  class: none(z.enum(["infrastructure", "system", "not_run"])),
  /** A short, stable kind, such as `timeout`, `rate-limited` or `bad-request`. */
  kind: none(Text),
  /** A human-readable message. It may contain content from the system. */
  message: content(z.string()).optional(),
});
/** A trial failure. */
export type TrialFailure = z.infer<typeof TrialFailure>;

/**
 * The configuration the worker actually ran with. Before scoring, Ichnaea compares it with the
 * arm's planned configuration and refuses the trial on any difference.
 */
export const ObservedConfiguration = z.strictObject({
  /** The commit of the system's code, as 40 hexadecimal characters. */
  commit: none(z.string().regex(/^[0-9a-f]{40}$/)),
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
 * order. It carries the raw output, never a score or a verdict, because the base suite's scorers
 * read the output later (REQ-22). It carries no times: Ichnaea measures `startedAt` and `endedAt`
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
  /** The model calls made in this trial. Required: the run's call bound and budget sum it. */
  calls: none(z.int().min(0)),
  /** The configuration the worker ran with. */
  observed: ObservedConfiguration,
});
/** A trial result. */
export type TrialResult = z.infer<typeof TrialResult>;
