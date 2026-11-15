import type * as z from "zod";

/**
 * The metadata key that carries a field's data policy, both in zod metadata and in the
 * generated JSON Schema (as an annotation keyword).
 */
export const DATA_POLICY_KEY = "x-ichnaea-data" as const;

/** Personal-data classes, ordered from least to most sensitive. */
export const DATA_CLASSES = ["none", "pseudonymous", "personal", "special"] as const;
/** A personal-data class (none, pseudonymous, personal, special). */
export type DataClass = (typeof DATA_CLASSES)[number];

/** What kind of identifier a field is, for redaction and release checks. */
export const IDENTIFIER_KINDS = ["none", "direct", "quasi", "content"] as const;
/** An identifier kind. */
export type IdentifierKind = (typeof IDENTIFIER_KINDS)[number];

/**
 * A field's data policy.
 *
 * `class: "inherit"` means the field carries content whose class the record declares in its own
 * `dataClass` field (for example a trial output: synthetic in CI, personal in production).
 * `egress` is the purpose allow-list. Absent means every purpose for class `none`, and no purpose
 * for any other class.
 */
export interface DataPolicy {
  readonly class: DataClass | "inherit";
  readonly identifier: IdentifierKind;
  readonly egress?: readonly string[];
  readonly retention?: string;
}

function withPolicy<T extends z.ZodType>(schema: T, policy: DataPolicy): T {
  return schema.meta({ [DATA_POLICY_KEY]: policy }) as T;
}

/** Marks a field as holding no personal data. */
export function none<T extends z.ZodType>(schema: T): T {
  return withPolicy(schema, { class: "none", identifier: "none" });
}

/** Marks a field as content whose class the enclosing record declares in `dataClass`. */
export function content<T extends z.ZodType>(schema: T): T {
  return withPolicy(schema, { class: "inherit", identifier: "content" });
}

/** Marks a field as a keyed pseudonym (still personal data under GDPR). */
export function pseudonym<T extends z.ZodType>(schema: T, egress: readonly string[] = []): T {
  return withPolicy(schema, { class: "pseudonymous", identifier: "direct", egress });
}

/** Marks a field with an explicit policy. */
export function classified<T extends z.ZodType>(schema: T, policy: DataPolicy): T {
  return withPolicy(schema, policy);
}

/** Returns the rank of a class, for comparisons. */
export function classRank(dataClass: DataClass): number {
  return DATA_CLASSES.indexOf(dataClass);
}
