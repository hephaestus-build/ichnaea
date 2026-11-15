import * as z from "zod";

import { content, none, quasi } from "../data-class.ts";
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
 */
export const Outcome = z.enum([
  "completed",
  "abstained",
  "system_failure",
  "infrastructure_failure",
  "budget_exceeded",
  "invalid_configuration",
  "not_run",
]);
/** A trial outcome. */
export type Outcome = z.infer<typeof Outcome>;

/** One step inside a trial: a model call, a tool call, a retrieval or a user turn. */
export const Step = z.object({
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
export const Usage = z.object({
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
export const Observation = z.object({
  name: none(Text),
  value: content(Json),
  expected: content(Json).optional(),
});

/** The normalised evidence of one trial or one sampled production interaction (REQ-19, REQ-20). */
export const Trial = z.object({
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
  outcome: none(Outcome),
  dataClass: none(RecordDataClass),
  input: content(Json).optional(),
  output: content(Json).optional(),
  pointer: quasi(Text).optional(),
  steps: z.array(Step).optional(),
  usage: Usage.optional(),
  observed: z.array(Observation).optional(),
  signals: content(z.record(z.string(), Json)).optional(),
  cache: z.object({ hit: none(z.boolean()), from: none(TrialId).optional() }).optional(),
  evidence: z.array(DigestRef).optional(),
  joinKeys: quasi(z.record(z.string(), z.string())).optional(),
  error: z.object({ kind: none(Text), message: content(z.string()).optional() }).optional(),
  startedAt: none(Timestamp).optional(),
  endedAt: none(Timestamp).optional(),
  inputDigest: none(Digest).optional(),
});
/** A trial record. */
export type Trial = z.infer<typeof Trial>;
