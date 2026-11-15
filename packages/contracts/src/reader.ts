import * as z from "zod";

import { toReaderJsonSchema } from "./json-schema.ts";
import type { RecordContract } from "./registry.ts";

/** A value that the writer schema does not know, found by the tolerant reader. */
export interface UnknownValue {
  readonly path: readonly PropertyKey[];
  readonly value: unknown;
}

/**
 * The type a tolerant reader returns: every string enumeration may also hold a string a later
 * minor version added, and every tagged union a kind it added. Code must handle the unknown case.
 */
export type Lenient<T> = T extends string
  ? string extends T
    ? T
    : T | (string & { readonly __unknownValue?: never })
  : T extends readonly (infer U)[]
    ? ReadonlyArray<Lenient<U>>
    : T extends object
      ? { readonly [K in keyof T]: Lenient<T[K]> }
      : T;

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
