import type * as z from "zod";

import { Json } from "./primitives.ts";
import { children, defType } from "./walk.ts";

/**
 * Definition types that a contract schema may not use (REQ-02, REQ-108). Refinements and
 * transforms vanish in JSON Schema, and defaults split input and output types, so the generated
 * schema would no longer be faithful to the zod source.
 */
export const FORBIDDEN_DEF_TYPES: readonly string[] = [
  "default",
  "prefault",
  "catch",
  "pipe",
  "transform",
  "custom",
  "promise",
  "function",
  "date",
  "bigint",
  "symbol",
  "undefined",
  "map",
  "set",
  "nan",
  "any",
  "unknown",
  "never",
  "void",
  "tuple",
  "intersection",
  "nonoptional",
  "lazy",
];

/** Check kinds that rewrite a value (trim, case changes, overwrite) or run arbitrary code. */
export const FORBIDDEN_CHECKS: readonly string[] = ["custom", "overwrite"];

/** True for the JSON value schema or a copy of it with metadata (`.meta()` keeps a parent link). */
function isJsonValue(node: z.ZodType): boolean {
  for (
    let current: z.ZodType | undefined = node;
    current;
    current = (current._zod as unknown as { parent?: z.ZodType }).parent
  ) {
    if (current === Json) return true;
  }
  return false;
}

/** One violation of the contract rules. */
export interface ContractViolation {
  readonly path: string;
  readonly rule: string;
}

/**
 * Checks a contract schema for refinements, transforms, defaults and non-JSON types. Returns every
 * violation with its path. Recursive schemas (the JSON value type) are walked once.
 */
export function lintContractSchema(schema: z.ZodType, path = "$"): ContractViolation[] {
  const out: ContractViolation[] = [];
  const seen = new Set<z.ZodType>();
  const visit = (node: z.ZodType, at: string): void => {
    if (seen.has(node)) return;
    seen.add(node);
    // The JSON value type is the one recursive (lazy) schema a contract may use.
    if (isJsonValue(node)) return;
    const type = defType(node);
    if (FORBIDDEN_DEF_TYPES.includes(type))
      out.push({ path: at, rule: `no '${type}' in contracts` });
    const checks = (node._zod.def as { checks?: Array<{ _zod: { def: { check: string } } }> })
      .checks;
    for (const check of checks ?? []) {
      const kind = check._zod.def.check;
      if (FORBIDDEN_CHECKS.includes(kind))
        out.push({ path: at, rule: `no '${kind}' check in contracts` });
    }
    for (const [label, child] of children(node)) visit(child, `${at}.${label}`);
  };
  visit(schema, path);
  return out;
}
