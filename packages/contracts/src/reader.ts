import type * as z from "zod";

import type { RecordContract } from "./registry.ts";
import { children, defType, unwrap } from "./walk.ts";

/** A value outside a known enumeration, found by the tolerant reader. */
export interface UnknownValue {
  readonly path: readonly PropertyKey[];
  readonly value: string;
  readonly known: readonly unknown[];
}

/** The result of a tolerant read. */
export type ReadResult<T> =
  | { readonly ok: true; readonly record: T; readonly unknownValues: readonly UnknownValue[] }
  | { readonly ok: false; readonly error: z.ZodError };

function getAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let node = root;
  for (const key of path) node = (node as Record<PropertyKey, unknown> | undefined)?.[key];
  return node;
}

function setAt(root: unknown, path: readonly PropertyKey[], value: unknown): void {
  let node = root as Record<PropertyKey, unknown>;
  for (const key of path.slice(0, -1)) node = node[key] as Record<PropertyKey, unknown>;
  node[path[path.length - 1] as PropertyKey] = value;
}

/** True when some schema node the path can reach is an enumeration (never a literal). */
function reachesEnum(schema: z.ZodType, path: readonly PropertyKey[]): boolean {
  const node = unwrap(schema);
  const type = defType(node);
  if (type === "union") return children(node).some(([, option]) => reachesEnum(option, path));
  if (path.length === 0) return type === "enum";
  const [head, ...rest] = path;
  const kids = new Map(children(node));
  if (type === "object") {
    const child =
      typeof head === "string" && Object.hasOwn(Object.fromEntries(kids), head)
        ? kids.get(head)
        : kids.get("*");
    return child ? reachesEnum(child, rest) : false;
  }
  if (type === "array") return reachesEnum(kids.get("[]") as z.ZodType, rest);
  if (type === "record") return reachesEnum(kids.get("<value>") as z.ZodType, rest);
  return false;
}

/**
 * Reads a record tolerantly (REQ-05). Unknown members are dropped, as every reader does. A string
 * outside a known enumeration (a value added in a later minor version) does not fail the read: it
 * is kept in the record and reported in `unknownValues`, so the caller decides what it means. A
 * caller must treat such a value as unknown, never as one of the values it knows.
 *
 * Discriminators of tagged unions are not tolerated: a new kind of record part is a new major.
 */
export function readRecord<T>(
  contract: RecordContract & { schema: z.ZodType<T> },
  value: unknown,
): ReadResult<T> {
  const first = contract.schema.safeParse(value);
  if (first.success) return { ok: true, record: first.data, unknownValues: [] };
  const working = structuredClone(value);
  const unknownValues: UnknownValue[] = [];
  let result: z.ZodSafeParseResult<T> = first;
  for (let round = 0; round < 8 && !result.success; round++) {
    const issues = result.error.issues;
    const enumIssues = issues.filter(
      (i) =>
        i.code === "invalid_value" &&
        typeof getAt(working, i.path) === "string" &&
        reachesEnum(contract.schema, i.path),
    );
    if (enumIssues.length !== issues.length || enumIssues.length === 0)
      return { ok: false, error: first.error };
    for (const issue of enumIssues) {
      const known = (issue as { values: unknown[] }).values;
      unknownValues.push({ path: issue.path, value: getAt(working, issue.path) as string, known });
      setAt(working, issue.path, known[0]);
    }
    result = contract.schema.safeParse(working);
  }
  if (!result.success) return { ok: false, error: first.error };
  const record: T = result.data;
  for (const u of unknownValues) setAt(record, u.path, u.value);
  return { ok: true, record, unknownValues };
}
