import type * as z from "zod";

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
];

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
    const type = defType(node);
    if (FORBIDDEN_DEF_TYPES.includes(type))
      out.push({ path: at, rule: `no '${type}' in contracts` });
    const checks = (node._zod.def as { checks?: Array<{ _zod: { def: { check: string } } }> })
      .checks;
    for (const check of checks ?? []) {
      if (check._zod.def.check === "custom")
        out.push({ path: at, rule: "no refinements in contracts" });
    }
    if (type === "lazy") {
      visit((node._zod.def as unknown as { getter: () => z.ZodType }).getter(), at);
      return;
    }
    for (const [label, child] of children(node)) visit(child, `${at}.${label}`);
  };
  visit(schema, path);
  return out;
}
