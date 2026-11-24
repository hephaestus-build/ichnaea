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

/**
 * The purposes of processing (the governance purpose catalogue). PU-1 is offline evaluation on
 * synthetic, licensed or own data; PU-2 production sampling for automatic judging; PU-3 human
 * rating of production outputs; PU-4 promotion of confirmed production failures into cases; PU-5
 * research use including publication; PU-6 sharing outside the controller.
 */
export const PURPOSES = ["PU-1", "PU-2", "PU-3", "PU-4", "PU-5", "PU-6"] as const;
/** A purpose of processing. */
export type Purpose = (typeof PURPOSES)[number];

/** The purpose wildcard: the field may leave for any purpose, within its class. */
export const ANY_PURPOSE = "*" as const;

/**
 * Retention rules. `record`: the field lives as long as its record in its store. `subject`: the
 * field also goes when the person it refers to is erased, through the lineage closure.
 */
export const RETENTION_RULES = ["record", "subject"] as const;
/** A retention rule. */
export type RetentionRule = (typeof RETENTION_RULES)[number];

/**
 * A field's data policy (REQ-135).
 *
 * - `class: "inherit"` marks content whose class the record declares in its own `dataClass` field
 *   (for example a trial output: synthetic in CI, personal in production).
 * - `egress` is the purpose allow-list the contract grants. A deployment may grant more purposes
 *   for its own fields with an overlay (`projectForEgress`), never fewer classes.
 * - `retention` is `record` or `subject` (erased with the person).
 */
export interface DataPolicy {
  /** The field's personal-data class, or `inherit` to take the class the record declares. */
  readonly class: DataClass | "inherit";
  /** What kind of identifier the field is. */
  readonly identifier: IdentifierKind;
  /** The purposes for which the field may leave; `*` permits any purpose. */
  readonly egress: readonly string[];
  /** How long the field is kept: with its record, or until its person is erased. */
  readonly retention: RetentionRule;
}

function withPolicy<T extends z.ZodType>(
  schema: T,
  policy: DataPolicy,
  extra: Record<string, unknown> = {},
): T {
  return schema.meta({ ...extra, [DATA_POLICY_KEY]: policy }) as T;
}

/**
 * Marks a closed enumeration, which readers do not widen: a value set fixed by its definition
 * (IEEE 754's non-finite values), or one whose unknown values must fail closed (the trial outcomes,
 * so no reader decides a run from an outcome it does not know). Tolerant readers widen every other
 * enumeration.
 */
export const CLOSED_KEY = "x-ichnaea-closed" as const;

/** A field without personal data. It may leave for any purpose. */
export function none<T extends z.ZodType>(schema: T, extra: Record<string, unknown> = {}): T {
  return withPolicy(
    schema,
    { class: "none", identifier: "none", egress: [ANY_PURPOSE], retention: "record" },
    extra,
  );
}

/** Content classified explicitly or by the enclosing record's `dataClass`. */
export function content<T extends z.ZodType>(
  schema: T,
  classification: DataClass | "inherit" = "inherit",
): T {
  return withPolicy(schema, {
    class: classification,
    identifier: "content",
    egress: [ANY_PURPOSE],
    retention: "subject",
  });
}

/**
 * A quasi-identifying attribute whose class the record declares in `dataClass`, such as a slice
 * value: harmless on a synthetic case, identifying in combination on collected data.
 */
export function attribute<T extends z.ZodType>(schema: T): T {
  return withPolicy(schema, {
    class: "inherit",
    identifier: "quasi",
    egress: [ANY_PURPOSE],
    retention: "subject",
  });
}

/** A keyed pseudonym (still personal data). It leaves only for the listed purposes. */
export function pseudonym<T extends z.ZodType>(schema: T, egress: readonly Purpose[] = []): T {
  return withPolicy(schema, {
    class: "pseudonymous",
    identifier: "direct",
    egress,
    retention: "subject",
  });
}

/** A quasi-identifier such as a pointer into an application or a join key. */
export function quasi<T extends z.ZodType>(schema: T, egress: readonly Purpose[] = []): T {
  return withPolicy(schema, {
    class: "pseudonymous",
    identifier: "quasi",
    egress,
    retention: "subject",
  });
}

/** A direct identifier of a person, such as a name. It leaves only for the listed purposes. */
export function personal<T extends z.ZodType>(schema: T, egress: readonly Purpose[] = []): T {
  return withPolicy(schema, {
    class: "personal",
    identifier: "direct",
    egress,
    retention: "subject",
  });
}

/** Returns the rank of a class, for comparisons. */
export function classRank(dataClass: DataClass): number {
  return DATA_CLASSES.indexOf(dataClass);
}
