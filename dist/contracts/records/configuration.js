import * as z from "zod";
import { none } from "../data-class.js";
import { Digest, Json, Text } from "../primitives.js";
/** Control status of a factor. */
export const FactorStatus = z.enum(["pinned", "observed", "declared", "uncontrollable"]);
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
export const Factor = z.strictObject({
    value: none(Json),
    status: none(FactorStatus.describe("The control status of the value: pinned, observed, declared or uncontrollable.")),
    part: none(FactorPart.describe("The part of the system that the factor belongs to.")),
});
/** A named value of the model's identity with its control status. Never empty. */
export const IdentityFactor = z.strictObject({
    value: none(Text.describe("The value. It is never empty.")),
    status: none(z.enum(["pinned", "declared"]).describe("Whether the value is pinned or only declared.")),
});
/** One model the system uses, under a role name (for example `answer` or `rerank`). */
export const ModelBinding = z.strictObject({
    role: none(Text.describe("The role that the model plays, for example answer or rerank.")),
    provider: IdentityFactor.describe("The model provider."),
    id: IdentityFactor.describe("The model ID."),
    version: IdentityFactor.describe("The model version, when the provider names one.").optional(),
    route: IdentityFactor.describe("The route that the calls take, such as a deployment or a gateway route.").optional(),
});
/**
 * One generation parameter. `origin: "default"` records a value the system did not set and the
 * provider applies, so all parameters are recorded, set or not (REQ-14).
 */
export const Parameter = z.strictObject({
    name: none(Text.describe("The parameter's name.")),
    value: none(Json),
    status: none(z.enum(["pinned", "declared", "uncontrollable"]).describe("The control status of the value.")),
    origin: none(z
        .enum(["explicit", "default"])
        .describe("explicit when the system sets the value, default when the provider applies it.")),
});
/**
 * A prompt template the system uses, by digest: the SHA-256 of the template's UTF-8 bytes. The
 * template text and its uri may be recorded; they do not enter the identity (`DIGEST_RULES`).
 */
export const PromptBinding = z.strictObject({
    name: none(Text.describe("The template's name.")),
    digest: none(Digest.describe("The SHA-256 of the template's UTF-8 bytes.")),
    status: none(FactorStatus.describe("The control status of the template.")),
    template: none(z.string().describe("The template text. It does not enter the identity.")).optional(),
    uri: none(Text.describe("Where the template is kept. It does not enter the identity.")).optional(),
});
/**
 * A resolved system configuration (REQ-14, REQ-148).
 *
 * At least one model with a non-empty provider and ID, and at least one generation parameter,
 * are required, so a configuration without them does not validate. Everything else that decides
 * behaviour goes into `factors` under a dotted name, for example `code.commit`,
 * `tool.retrieval.topK` or `data.corpus`. An `observed` factor is a value the system reported when
 * the configuration was resolved (for example a corpus digest); it is part of the identity.
 * Per-trial observations, such as the model identity a provider returns or a provider fingerprint,
 * belong in trial records, never here, so they never change the identity.
 */
export const Configuration = z.strictObject({
    schema: none(z.literal("ichnaea.configuration/1").describe("The record type and its major version.")),
    description: none(Text.describe("What the configuration is, for people.")),
    models: z.array(ModelBinding).min(1).describe("The models that the system uses. At least one."),
    parameters: z
        .array(Parameter)
        .min(1)
        .describe("Every generation parameter, whether the system sets it or the provider applies a default. At least one."),
    prompts: z.array(PromptBinding).describe("The prompt templates that the system uses, by digest."),
    factors: z
        .record(Text, Factor)
        .describe("Everything else that decides behavior, under dotted names such as code.commit or tool.retrieval.topK."),
    label: none(z.string().describe("A short name for people.")).optional(),
    /**
     * Informational values that do not decide behaviour and never enter the identity, for example a
     * provider fingerprint seen when the configuration was resolved. Per-trial fingerprints belong in
     * `Trial.observed`.
     */
    informational: none(z
        .record(Text, Json)
        .describe("Values that do not decide behavior and never enter the identity, such as a provider fingerprint.")).optional(),
});
//# sourceMappingURL=configuration.js.map