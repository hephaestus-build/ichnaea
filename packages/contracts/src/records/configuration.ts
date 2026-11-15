import * as z from "zod";

import { none } from "../data-class.ts";
import { Digest, Json, Text } from "../primitives.ts";

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

/** A named value of the model's identity with its control status. Never empty. */
export const IdentityFactor = z.object({
  value: none(Text),
  status: none(z.enum(["pinned", "declared"])),
});

/** One model the system uses, under a role name (for example `answer` or `rerank`). */
export const ModelBinding = z.object({
  role: none(Text),
  provider: IdentityFactor,
  id: IdentityFactor,
  version: IdentityFactor.optional(),
  route: IdentityFactor.optional(),
});

/**
 * One generation parameter. `origin: "default"` records a value the system did not set and the
 * provider applies, so all parameters are recorded, set or not (REQ-14).
 */
export const Parameter = z.object({
  name: none(Text),
  value: none(Json),
  status: none(FactorStatus),
  origin: none(z.enum(["explicit", "default"])),
});

/** A prompt template the system uses, by digest. */
export const PromptBinding = z.object({
  name: none(Text),
  digest: none(Digest),
  status: none(FactorStatus),
});

/**
 * A resolved system configuration (REQ-14, REQ-148).
 *
 * At least one model with a non-empty provider and ID, and at least one generation parameter,
 * are required, so a configuration without them does not validate. Everything else that decides
 * behaviour goes into `factors` under a dotted name, for example `code.commit`,
 * `tool.retrieval.topK` or `data.corpus`. Observed per-trial values, such as the model identity a
 * provider returns or a provider fingerprint, belong in trial records, never here.
 */
export const Configuration = z.object({
  schema: none(z.literal("ichnaea.configuration/1")),
  description: none(Text),
  models: z.array(ModelBinding).min(1),
  parameters: z.array(Parameter).min(1),
  prompts: z.array(PromptBinding),
  factors: z.record(Text, Factor),
  label: none(z.string()).optional(),
});
/** A resolved system configuration. */
export type Configuration = z.infer<typeof Configuration>;
