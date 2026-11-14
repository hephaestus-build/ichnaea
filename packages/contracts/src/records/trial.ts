import * as z from "zod";

import { classified, content, none } from "../data-class.ts";
import {
  CaseId,
  ConfigurationIdentity,
  Digest,
  DigestRef,
  Json,
  RecordDataClass,
  RunId,
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
  name: none(z.string().min(1)).optional(),
  model: none(z.string().min(1)).optional(),
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
  costUnit: none(z.string().min(1)).optional(),
  wallMs: none(z.number().min(0)).optional(),
});

/** An observed factor value reported by the system for this trial. */
export const Observation = z.object({
  name: none(z.string().min(1)),
  value: none(Json),
  expected: none(Json).optional(),
});

/** The normalised evidence of one trial or one sampled production interaction (REQ-19, REQ-20). */
export const Trial = z.object({
  schema: none(z.literal("ichnaea.trial/1")),
  id: none(TrialId),
  source: none(z.enum(["offline", "online"])),
  run: none(RunId).optional(),
  case: none(CaseId.nullable()),
  unit: none(Unit),
  configuration: none(ConfigurationIdentity),
  arm: none(z.enum(["base", "candidate"])).optional(),
  replicate: none(z.int().min(0)),
  outcome: none(Outcome),
  dataClass: none(RecordDataClass),
  input: content(Json).optional(),
  output: content(Json).optional(),
  pointer: none(z.string().min(1)).optional(),
  steps: z.array(Step).optional(),
  usage: Usage.optional(),
  observed: z.array(Observation).optional(),
  signals: content(z.record(z.string(), Json)).optional(),
  cache: z.object({ hit: none(z.boolean()), from: none(TrialId).optional() }).optional(),
  evidence: z.array(DigestRef).optional(),
  joinKeys: classified(z.record(z.string(), z.string()), {
    class: "pseudonymous",
    identifier: "quasi",
  }).optional(),
  error: z
    .object({ kind: none(z.string().min(1)), message: content(z.string()).optional() })
    .optional(),
  startedAt: none(Timestamp).optional(),
  endedAt: none(Timestamp).optional(),
  inputDigest: none(Digest).optional(),
});
/** A trial record. */
export type Trial = z.infer<typeof Trial>;
