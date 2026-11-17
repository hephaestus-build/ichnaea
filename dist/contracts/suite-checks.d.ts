import type { SuiteV2 } from "./records/suite-v2.ts";
/**
 * The reasons for which `ichnaea lock` refuses a suite that its schema accepts. Each names a rule
 * that a JSON Schema cannot express.
 */
export declare const SUITE_PROBLEM_CODES: readonly ["FIDELITY_MARGIN_MISSING", "FIDELITY_MARGIN_UNKNOWN", "LEVELS_NOT_ASCENDING", "LEVEL_CUT_NOT_A_LEVEL", "LEVEL_CUT_AT_LOWEST", "LEVEL_ANCHOR_NOT_A_LEVEL", "MEASURE_NOT_COMPUTED"];
/** A reason for which `ichnaea lock` refuses a suite. */
export type SuiteProblemCode = (typeof SUITE_PROBLEM_CODES)[number];
/** One rule that a suite breaks, at the JSON Pointer of the member that breaks it. */
export interface SuiteProblem {
    /** The named reason. */
    readonly code: SuiteProblemCode;
    /** The JSON Pointer (RFC 6901) of the member that breaks the rule. */
    readonly path: string;
    /** What is wrong, in words. */
    readonly message: string;
}
/**
 * The rules of a parsed suite that its schema cannot express. `ichnaea lock` refuses a suite with
 * any problem, and names each by its code:
 *
 * - `FIDELITY_MARGIN_MISSING`: a suite with an `attribute` block has no `attribute.fidelityMargin`
 *   entry for a secondary measure with a test. Only a primary measure has a registered limit, so
 *   only a primary measure defaults to half of it.
 * - `FIDELITY_MARGIN_UNKNOWN`: an `attribute.fidelityMargin` entry names neither a primary measure
 *   nor a secondary measure with a test, so attribute would never use it: a misspelled ID would
 *   leave its measure at the default.
 * - `LEVELS_NOT_ASCENDING`: a level measure's levels are not strictly ascending, so a level would
 *   appear twice or out of order.
 * - `LEVEL_CUT_NOT_A_LEVEL`: a level measure's `cut` is not one of its levels.
 * - `LEVEL_CUT_AT_LOWEST`: a level measure cuts at its lowest level, which makes every trial a
 *   success.
 * - `LEVEL_ANCHOR_NOT_A_LEVEL`: a key of a level measure's `anchors` is not one of its levels,
 *   written as JSON writes the number (`2`, `0.5`; not `2.0`).
 * - `MEASURE_NOT_COMPUTED`: a measure names neither a scorer nor a stage status (a `stage` with a
 *   `status`), so nothing computes its values and it has no implementation to lock.
 *
 * It returns no problem for a suite that breaks none.
 */
export declare function suiteProblems(suite: SuiteV2): SuiteProblem[];
//# sourceMappingURL=suite-checks.d.ts.map