import type { SuiteV2 } from "./records/suite-v2.ts";

/**
 * The reasons for which `ichnaea lock` refuses a suite that its schema accepts. Each names a rule
 * that a JSON Schema cannot express.
 */
export const SUITE_PROBLEM_CODES = [
  "FIDELITY_MARGIN_MISSING",
  "FIDELITY_MARGIN_UNKNOWN",
  "LEVELS_NOT_ASCENDING",
  "LEVEL_CUT_NOT_A_LEVEL",
  "LEVEL_CUT_AT_LOWEST",
  "LEVEL_ANCHOR_NOT_A_LEVEL",
] as const;

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
 * Whether a measure has a test, so that attribute can compare a replay with its recording on it: a
 * binary or score measure, or a level measure with `spacing`. A quantity is descriptive only, and a
 * level measure without `spacing` has no test.
 */
function hasTest(measure: SuiteV2["measures"][string] | undefined): boolean {
  if (measure === undefined || measure.type === "quantity") return false;
  return measure.type !== "level" || measure.spacing !== undefined;
}

/**
 * The secondary measures that attribute compares, each once: those with a test. An ID that names
 * no measure is left to the check of the suite's references.
 */
function attributedSecondaries(suite: SuiteV2): string[] {
  return [...new Set(suite.policy.secondary ?? [])].filter((id) => hasTest(suite.measures[id]));
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
 *
 * It returns no problem for a suite that breaks none.
 */
export function suiteProblems(suite: SuiteV2): SuiteProblem[] {
  const problems: SuiteProblem[] = [];
  if (suite.attribute !== undefined) {
    const margins = suite.attribute.fidelityMargin ?? {};
    const secondaries = attributedSecondaries(suite);
    for (const id of secondaries)
      if (!Object.hasOwn(margins, id))
        problems.push({
          code: "FIDELITY_MARGIN_MISSING",
          path: "/attribute/fidelityMargin",
          message: `secondary measure '${id}' has no fidelity margin; only a primary measure has a registered limit to default to half of`,
        });
    const compared = new Set([...Object.keys(suite.policy.primary), ...secondaries]);
    for (const id of Object.keys(margins))
      if (!compared.has(id))
        problems.push({
          code: "FIDELITY_MARGIN_UNKNOWN",
          path: `/attribute/fidelityMargin/${id}`,
          message: `the fidelity margin for '${id}' names no primary measure and no secondary measure with a test, so attribute never uses it`,
        });
  }
  for (const [id, measure] of Object.entries(suite.measures))
    if (measure.type === "level") problems.push(...levelProblems(id, measure));
  return problems;
}

/** The rules of one level measure that a schema cannot express. */
function levelProblems(
  id: string,
  measure: Extract<SuiteV2["measures"][string], { type: "level" }>,
): SuiteProblem[] {
  const problems: SuiteProblem[] = [];
  const { levels, anchors, spacing } = measure;
  const at = `/measures/${id}`;
  const listed = levels.join(", ");
  if (levels.some((level, i) => i > 0 && level <= (levels[i - 1] as number)))
    problems.push({
      code: "LEVELS_NOT_ASCENDING",
      path: `${at}/levels`,
      message: `measure '${id}' lists levels ${listed}; they must be strictly ascending`,
    });
  if (typeof spacing === "object") {
    const lowest = Math.min(...levels);
    if (!levels.includes(spacing.cut))
      problems.push({
        code: "LEVEL_CUT_NOT_A_LEVEL",
        path: `${at}/spacing/cut`,
        message: `measure '${id}' cuts at ${spacing.cut}, which is not one of its levels ${listed}`,
      });
    else if (spacing.cut <= lowest)
      problems.push({
        code: "LEVEL_CUT_AT_LOWEST",
        path: `${at}/spacing/cut`,
        message: `measure '${id}' cuts at its lowest level ${lowest}, so every trial would be a success`,
      });
  }
  // An anchor's key is a JSON member name, so it names a level as JSON writes the number.
  const names = new Set(levels.map(String));
  for (const key of Object.keys(anchors ?? {}))
    if (!names.has(key))
      problems.push({
        code: "LEVEL_ANCHOR_NOT_A_LEVEL",
        path: `${at}/anchors/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
        message: `measure '${id}' anchors '${key}', which is not one of its levels ${listed}`,
      });
  return problems;
}
