import type { SuiteV2 } from "./records/suite-v2.ts";

/**
 * The reasons for which `ichnaea lock` refuses a suite that its schema accepts. Each names a rule
 * that a JSON Schema cannot express.
 */
export const SUITE_PROBLEM_CODES = ["FIDELITY_MARGIN_MISSING"] as const;

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
 * The measures that attribute compares when the suite has an `attribute` block: the primary and
 * secondary measures that have a test. A quantity is descriptive only, so it has none.
 */
function attributedSecondaries(suite: SuiteV2): string[] {
  if (suite.attribute === undefined) return [];
  return (suite.policy.secondary ?? []).filter((id) => suite.measures[id]?.type !== "quantity");
}

/**
 * The rules of a parsed suite that its schema cannot express. `ichnaea lock` refuses a suite with
 * any problem, and names each by its code:
 *
 * - `FIDELITY_MARGIN_MISSING`: an attributed secondary measure has no `attribute.fidelityMargin`
 *   entry. Only a primary measure has a registered limit, so only a primary measure defaults to
 *   half of it.
 *
 * It returns no problem for a suite that breaks none.
 */
export function suiteProblems(suite: SuiteV2): SuiteProblem[] {
  const problems: SuiteProblem[] = [];
  const margins = suite.attribute?.fidelityMargin ?? {};
  for (const id of attributedSecondaries(suite))
    if (!Object.hasOwn(margins, id))
      problems.push({
        code: "FIDELITY_MARGIN_MISSING",
        path: "/attribute/fidelityMargin",
        message: `secondary measure '${id}' has no fidelity margin; only a primary measure has a registered limit to default to half of`,
      });
  return problems;
}
