import type * as z from "zod";
/**
 * Definition types that a contract schema may not use (REQ-02, REQ-108). Refinements and
 * transforms vanish in JSON Schema, and defaults split input and output types, so the generated
 * schema would no longer be faithful to the zod source.
 */
export declare const FORBIDDEN_DEF_TYPES: readonly string[];
/** Check kinds that rewrite a value (trim, case changes, overwrite) or run arbitrary code. */
export declare const FORBIDDEN_CHECKS: readonly string[];
/** One violation of the contract rules. */
export interface ContractViolation {
    readonly path: string;
    readonly rule: string;
}
/**
 * Checks a contract schema for refinements, transforms, defaults and non-JSON types. Returns every
 * violation with its path. Recursive schemas (the JSON value type) are walked once.
 */
export declare function lintContractSchema(schema: z.ZodType, path?: string): ContractViolation[];
/**
 * Checks data policies (REQ-135). Every object member carries a policy, unless an enclosing
 * container carries a restrictive one (`pseudonymous`, `personal` or `special`), which covers its
 * whole subtree. A field's policy covers its scalar parts (array elements, union options), but a
 * permissive policy (`none`, `inherit`) never covers the members of an object below it: each needs
 * its own, so nothing leaves unclassified.
 */
export declare function lintDataPolicies(schema: z.ZodType, path?: string): ContractViolation[];
//# sourceMappingURL=lint.d.ts.map