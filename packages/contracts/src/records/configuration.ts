import * as z from "zod";

import { none } from "../data-class.ts";
import { Digest, Json } from "../primitives.ts";

/** Control status of a factor. */
export const FactorStatus = z.enum(["pinned", "observed", "declared", "uncontrollable"]);
/** A factor's control status. */
export type FactorStatus = z.infer<typeof FactorStatus>;

/** The part of the system a factor belongs to. */
export const FactorPart = z.enum([
  "code",
  "prompt",
  "model",
  "runtime",
  "parameter",
  "tool",
  "setting",
  "data",
  "other",
]);

/** One element of a configuration with its value and control status (REQ-14). */
export const Factor = z.object({
  value: none(Json),
  status: none(FactorStatus),
  part: none(FactorPart),
});
/** A factor. */
export type Factor = z.infer<typeof Factor>;

/** One model the system uses, under a role name (for example `answer` or `rerank`). */
export const ModelBinding = z.object({
  role: none(z.string().min(1)),
  provider: Factor,
  id: Factor,
  version: Factor.optional(),
  route: Factor.optional(),
});

/** A prompt template the system uses, by digest. */
export const PromptBinding = z.object({
  name: none(z.string().min(1)),
  digest: none(Digest),
  status: none(FactorStatus),
});

/**
 * A resolved system configuration (REQ-14, REQ-148).
 *
 * Model identities and generation parameters are required parts, so a configuration without them
 * does not validate. Everything else that decides behaviour goes into `factors` under a dotted
 * name, for example `code.commit`, `tool.retrieval.topK` or `data.corpus`.
 */
export const Configuration = z.object({
  schema: none(z.literal("ichnaea.configuration/1")),
  description: none(z.string().min(1)),
  models: z.array(ModelBinding).min(1),
  parameters: z.record(z.string().min(1), Factor),
  prompts: z.array(PromptBinding),
  factors: z.record(z.string().min(1), Factor),
  label: none(z.string()).optional(),
});
/** A resolved system configuration. */
export type Configuration = z.infer<typeof Configuration>;

/**
 * Configuration fields that never enter the configuration identity: they are names for people,
 * not behaviour.
 */
export const IDENTITY_EXCLUDED_FIELDS: readonly string[] = ["label"];
