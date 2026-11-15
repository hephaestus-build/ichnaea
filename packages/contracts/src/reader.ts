import * as z from "zod";

import { toReaderJsonSchema } from "./json-schema.ts";
import type { RecordContract } from "./registry.ts";

/** A value that the writer schema does not know, found by the tolerant reader. */
export interface UnknownValue {
  readonly path: readonly PropertyKey[];
  readonly value: unknown;
}

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;

/** The members whose value is a string literal in every arm: the tag of a tagged union. */
type Discriminator<T> = {
  [K in keyof T]-?: T[K] extends string ? (string extends T[K] ? never : K) : never;
}[keyof T];

type Tagged<T> = Exclude<Extract<T, object>, readonly unknown[]>;

/**
 * An object of a kind that a later minor version added to a tagged union. Its tag is a string no
 * known kind uses, and nothing else about it is known. `__unknownKind` exists only in the type.
 */
export type UnknownKind<T> = { readonly [K in Discriminator<T>]: string } & {
  readonly __unknownKind: true;
};

/**
 * The type a tolerant reader returns: every string enumeration may also hold a string a later
 * minor version added, and every tagged union an unknown kind. A single string literal (a schema
 * ID, the tag of a known kind) stays exact. Code must handle the unknown case: narrow a tagged
 * value with `isKnownKind` before reading the members of a known kind.
 */
export type Lenient<T> =
  | LenientValue<T>
  | (true extends IsUnion<Tagged<T>>
      ? [Discriminator<Tagged<T>>] extends [never]
        ? never
        : UnknownKind<Tagged<T>>
      : never);

type LenientValue<T> = [T] extends [string]
  ? string extends T
    ? T
    : true extends IsUnion<T>
      ? T | (string & { readonly __unknownValue?: never })
      : T
  : LenientMembers<T>;

type LenientMembers<T> = T extends readonly (infer U)[]
  ? ReadonlyArray<Lenient<U>>
  : T extends object
    ? { readonly [K in keyof T]: Lenient<T[K]> }
    : T;

/** Whether a tolerantly read tagged value has one of the kinds this version knows. */
export function isKnownKind<T extends object>(
  value: T,
  tag: string,
  known: readonly string[],
): value is Exclude<T, { readonly __unknownKind: true }> {
  return known.includes((value as Record<string, unknown>)[tag] as string);
}

/** The result of a tolerant read. */
export type ReadResult<T> =
  | {
      readonly ok: true;
      readonly record: Lenient<T>;
      readonly unknownValues: readonly UnknownValue[];
      /** Paths of members the writer schema does not define. Readers ignore them. */
      readonly unknownMembers: ReadonlyArray<readonly PropertyKey[]>;
    }
  | { readonly ok: false; readonly error: z.ZodError };

const readers = new Map<string, z.ZodType>();

/**
 * The reader zod schema of a contract, built from the reader JSON Schema so that zod and every
 * other validator of the reader schema agree by construction.
 */
export function readerSchema(contract: RecordContract): z.ZodType {
  let reader = readers.get(contract.id);
  if (!reader) {
    reader = z.fromJSONSchema(
      toReaderJsonSchema(contract) as Parameters<typeof z.fromJSONSchema>[0],
    );
    readers.set(contract.id, reader);
  }
  return reader;
}

function hasLoneSurrogate(value: unknown): boolean {
  if (typeof value === "string") return !value.isWellFormed();
  if (Array.isArray(value)) return value.some(hasLoneSurrogate);
  if (value && typeof value === "object")
    return Object.entries(value).some(([k, v]) => !k.isWellFormed() || hasLoneSurrogate(v));
  return false;
}

/**
 * Reads a record tolerantly (REQ-05). It validates against the reader schema: unknown members are
 * ignored, a string outside a known enumeration and a tagged-union kind the writer schema does not
 * know are accepted and reported in `unknownValues`, and unknown members in `unknownMembers`. The `schema` field and other constants stay
 * strict. Strings must be well-formed Unicode, because a record must stay hashable.
 *
 * A schema cannot compare two values, so reading does not check a prompt template against its
 * digest or a stored identity against its configuration. `verifyConfiguration` and `verifyArms`
 * do.
 */
export function readRecord<T>(
  contract: RecordContract & { schema: z.ZodType<T> },
  value: unknown,
): ReadResult<T> {
  const read = readerSchema(contract).safeParse(value);
  if (!read.success) return { ok: false, error: read.error };
  if (hasLoneSurrogate(value)) {
    return {
      ok: false,
      error: new z.ZodError([
        { code: "custom", path: [], message: "lone surrogate in a string", input: value },
      ]),
    };
  }
  const strict = contract.schema.safeParse(value);
  const issues = strict.success ? [] : strict.error.issues;
  const unknownMembers = issues.flatMap((i) =>
    i.code === "unrecognized_keys" ? i.keys.map((k) => [...i.path, k]) : [],
  );
  const unknownValues = issues
    .filter((i) => i.code !== "unrecognized_keys")
    .map((i) => ({ path: i.path, value: valueAt(value, i.path) }));
  return { ok: true, record: structuredClone(value) as Lenient<T>, unknownValues, unknownMembers };
}

function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let node = root;
  for (const key of path) node = (node as Record<PropertyKey, unknown> | undefined)?.[key];
  return node;
}
