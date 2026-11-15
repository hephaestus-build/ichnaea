import type * as z from "zod";

import { type DataClass, type DataPolicy, classRank, DATA_CLASSES } from "./data-class.ts";
import { children, defType, policyOf, unwrap } from "./walk.ts";

/** What a destination accepts: one purpose and the most sensitive class it may receive. */
export interface EgressContext {
  readonly purpose: string;
  readonly maxClass: DataClass;
}

/** A record reduced to the fields that may cross a boundary, with the paths that were dropped. */
export interface EgressProjection {
  readonly value: unknown;
  readonly dropped: readonly string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordClassOf(record: unknown): DataClass {
  const declared = isPlainObject(record) ? record["dataClass"] : undefined;
  // A record that holds content but does not declare its class is treated as the most sensitive.
  return DATA_CLASSES.includes(declared as DataClass) ? (declared as DataClass) : "special";
}

function permits(policy: DataPolicy, recordClass: DataClass, context: EgressContext): boolean {
  const effective = policy.class === "inherit" ? recordClass : policy.class;
  if (classRank(effective) > classRank(context.maxClass)) return false;
  if (policy.egress === undefined) return effective === "none";
  return policy.egress.includes(context.purpose) || policy.egress.includes("*");
}

/**
 * Projects a record onto the fields that may leave for one purpose (REQ-135, PE-01, PE-12).
 *
 * A field passes only when its data policy permits the purpose and its class is within the
 * destination's maximum. Fields without a policy and fields the schema does not know are dropped:
 * unclassified data never crosses a boundary. Content fields take the class the record declares in
 * `dataClass`; a record without one is treated as `special`.
 */
export function projectForEgress(
  schema: z.ZodType,
  record: unknown,
  context: EgressContext,
): EgressProjection {
  const dropped: string[] = [];
  const recordClass = recordClassOf(record);

  const project = (node: z.ZodType, value: unknown, path: string, allowed: boolean): unknown => {
    const policy = policyOf(node);
    let permitted = allowed;
    if (policy) {
      permitted = permits(policy, recordClass, context);
      if (!permitted) {
        dropped.push(path || "/");
        return undefined;
      }
    }
    const inner = unwrap(node);
    const type = defType(inner);
    if (value === null || value === undefined) return value;
    if (type === "object" && isPlainObject(value)) {
      const shape = Object.fromEntries(children(inner).filter(([k]) => k !== "*"));
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) {
        const field = shape[key];
        if (!field) {
          dropped.push(`${path}/${key}`);
          continue;
        }
        const projected = project(field, child, `${path}/${key}`, permitted);
        if (projected !== undefined) out[key] = projected;
      }
      return out;
    }
    if (type === "array" && Array.isArray(value)) {
      const element = children(inner)[0]?.[1];
      if (!element) return undefined;
      return value
        .map((item, i) => project(element, item, `${path}/${i}`, permitted))
        .filter((item) => item !== undefined);
    }
    if (type === "union") {
      const option = children(inner)
        .map(([, o]) => o)
        .find((o) => o.safeParse(value).success);
      if (option) return project(option, value, path, permitted);
    }
    if (!permitted) {
      dropped.push(path || "/");
      return undefined;
    }
    // A permitted opaque value (a JSON payload, a record of strings) leaves as it is.
    return structuredClone(value);
  };

  const value = project(schema, record, "", false);
  return { value, dropped };
}
