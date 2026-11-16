import * as z from "zod";

import { CLOSED_KEY, content, none, quasi } from "../data-class.ts";
import {
  ArmName,
  CaseId,
  ConfigurationIdentity,
  Digest,
  DigestRef,
  Json,
  RecordDataClass,
  RunId,
  Text,
  Timestamp,
  TrialId,
  Unit,
} from "../primitives.ts";

/**
 * Outcome classes of a trial (REQ-20). A capture failure is never a verdict:
 * `infrastructure_failure` and `not_run` count as missing, never as a quality failure.
 * `protocol_failure` is the outcome of a worker failure of class `protocol` (`FAILURE_OUTCOME`), and
 * of nothing else. It is the harness's fault, never the system's: it is missing, never a failure or
 * a pass, and any one makes the run INVALID.
 *
 * The enumeration is closed (`x-ichnaea-closed`) from this version on: a reader built from it
 * refuses an outcome it does not know, so a later outcome fails closed. An older build's reader
 * widens it, so it reads `protocol_failure` as an unknown outcome and counts the trial as missing:
 * never as a pass or a failure of the system.
 */
export const Outcome = z.enum([
  "completed",
  "abstained",
  "system_failure",
  "infrastructure_failure",
  "budget_exceeded",
  "invalid_configuration",
  "not_run",
  "protocol_failure",
]);
/** A trial outcome. */
export type Outcome = z.infer<typeof Outcome>;

/** One step inside a trial: a model call, a tool call, a retrieval or a user turn. */
export const Step = z.strictObject({
  kind: none(z.enum(["model_call", "tool_call", "retrieval", "user_turn", "other"])),
  name: none(Text).optional(),
  model: none(Text).optional(),
  outcome: none(z.enum(["ok", "error", "refused", "timeout"])).optional(),
  inputTokens: none(z.int().min(0)).optional(),
  outputTokens: none(z.int().min(0)).optional(),
  durationMs: none(z.number().min(0)).optional(),
  detail: content(Json).optional(),
});

/** Resource usage of a trial as reported. Absent means unknown, never zero. */
export const Usage = z.strictObject({
  calls: none(z.int().min(0)).optional(),
  inputTokens: none(z.int().min(0)).optional(),
  outputTokens: none(z.int().min(0)).optional(),
  cost: none(z.number().min(0)).optional(),
  costUnit: none(Text).optional(),
  wallMs: none(z.number().min(0)).optional(),
});

/**
 * An observed factor value reported by the system for this trial, for example the model identity
 * a provider returned or a provider fingerprint (informational, never part of the identity).
 */
export const Observation = z.strictObject({
  name: none(Text),
  value: content(Json),
  expected: content(Json).optional(),
});

/** The normalised evidence of one trial or one sampled production interaction (REQ-19, REQ-20). */
export const Trial = z.strictObject({
  schema: none(z.literal("ichnaea.trial/1")),
  id: none(TrialId),
  source: none(z.enum(["offline", "online"])),
  run: none(RunId).optional(),
  case: none(CaseId.nullable()),
  caseDigest: none(Digest).optional(),
  unit: none(Unit),
  configuration: none(ConfigurationIdentity),
  arm: none(ArmName).optional(),
  replicate: none(z.int().min(0)),
  outcome: none(Outcome, { [CLOSED_KEY]: true }),
  dataClass: none(RecordDataClass),
  input: content(Json).optional(),
  output: content(Json).optional(),
  pointer: quasi(Text).optional(),
  steps: z.array(Step).optional(),
  usage: Usage.optional(),
  observed: z.array(Observation).optional(),
  signals: content(z.record(z.string(), Json)).optional(),
  cache: z.strictObject({ hit: none(z.boolean()), from: none(TrialId).optional() }).optional(),
  evidence: z.array(DigestRef).optional(),
  joinKeys: quasi(z.record(z.string(), z.string())).optional(),
  error: z.strictObject({ kind: none(Text), message: content(z.string()).optional() }).optional(),
  startedAt: none(Timestamp).optional(),
  endedAt: none(Timestamp).optional(),
  inputDigest: none(Digest).optional(),
  /**
   * The earlier attempts at this trial that a later one replaced, in order and numbered from 1 with
   * no gap: each an infrastructure failure or a trial not run, with the calls it made. The record is
   * the last attempt. The calls of every attempt count against the per-trial bound and the run's
   * budget, so a retry cannot hide an overrun.
   */
  attempts: z
    .array(
      z.strictObject({
        attempt: none(z.int().min(1)),
        failure: z.strictObject({
          class: none(z.enum(["infrastructure", "not_run"])),
          kind: none(Text),
        }),
        calls: none(z.int().min(0)),
      }),
    )
    .optional(),
});
/** A trial record. */
export type Trial = z.infer<typeof Trial>;
