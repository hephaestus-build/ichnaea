import type * as z from "zod";

/**
 * The metadata key that carries a field's data policy, both in zod metadata and in the
 * generated JSON Schema (as an annotation keyword).
 */
export const DATA_POLICY_KEY = "x-ichnaea-data" as const;

/** Personal-data classes, ordered from least to most sensitive. */
export const DATA_CLASSES = ["none", "pseudonymous", "personal", "special"] as const;
/** A personal-data class: none, pseudonymous, personal or special. */
export type DataClass = (typeof DATA_CLASSES)[number];

/** What kind of identifier a field is, for redaction and release checks. */
export const IDENTIFIER_KINDS = ["none", "direct", "quasi", "content"] as const;
/** An identifier kind. */
export type IdentifierKind = (typeof IDENTIFIER_KINDS)[number];

/** The purpose wildcard: the field may leave for any purpose, within its class. */
export const ANY_PURPOSE = "*" as const;

/**
 * A field's data policy (REQ-135).
 *
 * - `class: "inherit"` marks content whose class the record declares in its own `dataClass` field
 *   (for example a trial output: synthetic in CI, personal in production).
 * - `egress` is the purpose allow-list. A field leaves only for a listed purpose (or `*`) and only
 *   to a destination that accepts its class.
 * - `retention` names the retention rule: `record` follows the retention of the store that holds
 *   the record.
 */
export interface DataPolicy {
  readonly class: DataClass | "inherit";
  readonly identifier: IdentifierKind;
  readonly egress: readonly string[];
  readonly retention: string;
}

function withPolicy<T extends z.ZodType>(schema: T, policy: DataPolicy): T {
  return schema.meta({ [DATA_POLICY_KEY]: policy }) as T;
}

/** A field without personal data. It may leave for any purpose. */
export function none<T extends z.ZodType>(schema: T): T {
  return withPolicy(schema, {
    class: "none",
    identifier: "none",
    egress: [ANY_PURPOSE],
    retention: "record",
  });
}

/** Content whose class the enclosing record declares in `dataClass`. */
export function content<T extends z.ZodType>(schema: T): T {
  return withPolicy(schema, {
    class: "inherit",
    identifier: "content",
    egress: [ANY_PURPOSE],
    retention: "record",
  });
}

/** A keyed pseudonym (still personal data). It leaves only for the listed purposes. */
export function pseudonym<T extends z.ZodType>(schema: T, egress: readonly string[] = []): T {
  return withPolicy(schema, {
    class: "pseudonymous",
    identifier: "direct",
    egress,
    retention: "record",
  });
}

/** A quasi-identifier such as a pointer into an application or a join key. */
export function quasi<T extends z.ZodType>(schema: T, egress: readonly string[] = []): T {
  return withPolicy(schema, {
    class: "pseudonymous",
    identifier: "quasi",
    egress,
    retention: "record",
  });
}

/** A direct identifier of a person, such as a name. It leaves only for the listed purposes. */
export function personal<T extends z.ZodType>(schema: T, egress: readonly string[] = []): T {
  return withPolicy(schema, {
    class: "personal",
    identifier: "direct",
    egress,
    retention: "record",
  });
}

/** Returns the rank of a class, for comparisons. */
export function classRank(dataClass: DataClass): number {
  return DATA_CLASSES.indexOf(dataClass);
}
