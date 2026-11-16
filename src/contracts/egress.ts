import type * as z from "zod";

import {
  ANY_PURPOSE,
  type DataClass,
  type DataPolicy,
  classRank,
  DATA_CLASSES,
} from "./data-class.ts";
import { defType, policyOf, unwrap } from "./walk.ts";

/**
 * What a destination accepts: one purpose and the most sensitive class it may receive. `grants`
 * lets a deployment allow more purposes for named fields (JSON pointers into the record, `*` for
 * any array index or record key), for example after recording a basis for rater pseudonyms. A
 * grant never lifts the class limit.
 */
export interface EgressContext {
  readonly purpose: string;
  readonly maxClass: DataClass;
  readonly grants?: ReadonlyArray<{ readonly path: string; readonly purposes: readonly string[] }>;
}

/** A record reduced to the fields that may cross a boundary, with the paths that were dropped. */
export interface EgressProjection {
  readonly value: unknown;
  readonly dropped: readonly string[];
}

const DROP: unique symbol = Symbol("drop");
type Projected = unknown | typeof DROP;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function recordClassOf(record: unknown): DataClass {
  const declared =
    isPlainObject(record) && Object.hasOwn(record, "dataClass") ? record["dataClass"] : undefined;
  // A record that holds content but does not declare its class is treated as the most sensitive.
  return DATA_CLASSES.includes(declared as DataClass) ? (declared as DataClass) : "special";
}

function matches(pattern: string, path: string): boolean {
  const a = pattern.split("/");
  const b = path.split("/");
  return a.length === b.length && a.every((segment, i) => segment === "*" || segment === b[i]);
}

function permits(
  policy: DataPolicy,
  recordClass: DataClass,
  context: EgressContext,
  path: string,
): boolean {
  const effective = policy.class === "inherit" ? recordClass : policy.class;
  if (classRank(effective) > classRank(context.maxClass)) return false;
  if (policy.egress.includes(context.purpose) || policy.egress.includes(ANY_PURPOSE)) return true;
  return (context.grants ?? []).some(
    (g) => matches(g.path, path) && g.purposes.includes(context.purpose),
  );
}

/** Escapes one JSON pointer segment (RFC 6901). */
function pointerSegment(key: string | number): string {
  return String(key).replaceAll("~", "~0").replaceAll("/", "~1");
}

function def(node: z.ZodType): Record<string, unknown> {
  return node._zod.def as unknown as Record<string, unknown>;
}

/**
 * Projects a record onto the fields that may leave for one purpose (REQ-135).
 *
 * The projection is an allow-list walk of the schema. A value passes only where the schema
 * defines it, its data policy permits the purpose, its class is within the destination's maximum,
 * and it has the type the schema expects. Anything else is dropped: unknown members, members
 * without a policy, values of the wrong type, and union values that match no option. Content
 * fields take the class the record declares in `dataClass`; a record without one is treated as
 * `special`. Opaque content (a JSON payload) leaves whole only when its policy permits it.
 *
 * Use it with `maxClass: "special"` to filter by purpose alone at ingest.
 */
export function projectForEgress(
  schema: z.ZodType,
  record: unknown,
  context: EgressContext,
): EgressProjection {
  const dropped: string[] = [];
  const recordClass = recordClassOf(record);

  const drop = (path: string): typeof DROP => {
    dropped.push(path || "/");
    return DROP;
  };

  const project = (
    node: z.ZodType,
    value: unknown,
    path: string,
    permitted: boolean,
  ): Projected => {
    const policy = policyOf(node);
    let allowed = permitted;
    if (policy) {
      allowed = permits(policy, recordClass, context, path);
      if (!allowed) return drop(path);
    }
    const inner = unwrap(node);
    const type = defType(inner);
    if (value === null) return node.safeParse(null).success && allowed ? null : drop(path);
    switch (type) {
      case "object": {
        if (!isPlainObject(value)) return drop(path);
        const shape = def(inner)["shape"] as Record<string, z.ZodType>;
        const out: Array<[string, unknown]> = [];
        for (const key of Object.keys(value)) {
          const at = `${path}/${pointerSegment(key)}`;
          if (!Object.hasOwn(shape, key)) {
            drop(at);
            continue;
          }
          const projected = project(shape[key] as z.ZodType, value[key], at, allowed);
          if (projected !== DROP) out.push([key, projected]);
        }
        // Object.fromEntries defines members as data, so a `__proto__` member stays a member.
        return Object.fromEntries(out);
      }
      case "record": {
        if (!isPlainObject(value)) return drop(path);
        const keyType = def(inner)["keyType"] as z.ZodType;
        const valueType = def(inner)["valueType"] as z.ZodType;
        const out: Array<[string, unknown]> = [];
        for (const key of Object.keys(value)) {
          const at = `${path}/${pointerSegment(key)}`;
          if (!keyType.safeParse(key).success) {
            drop(at);
            continue;
          }
          const projected = project(valueType, value[key], at, allowed);
          if (projected !== DROP) out.push([key, projected]);
        }
        return Object.fromEntries(out);
      }
      case "array": {
        if (!Array.isArray(value)) return drop(path);
        const element = def(inner)["element"] as z.ZodType;
        const out: unknown[] = [];
        value.forEach((item, i) => {
          const projected = project(element, item, `${path}/${i}`, allowed);
          if (projected !== DROP) out.push(projected);
        });
        return out;
      }
      case "union": {
        const options = def(inner)["options"] as z.ZodType[];
        const option = options.find((o) => o.safeParse(value).success);
        return option ? project(option, value, path, allowed) : drop(path);
      }
      default: {
        // A leaf: it must be permitted and have the type the schema expects.
        if (!allowed || !inner.safeParse(value).success) return drop(path);
        return structuredClone(value);
      }
    }
  };

  const value = project(schema, record, "", false);
  return { value: value === DROP ? undefined : value, dropped };
}
