// Manual mutation testing of the decision rule and the records it reads, until StrykerJS runs at
// 1.0 (REQ-112). Each mutant is one source change that a test must detect. Run in a scratch copy of
// the repository, never in a working tree:
//   node scripts/decide/mutants.ts                 # every mutant
//   node scripts/decide/mutants.ts sensitivity     # the mutants whose ID starts with the argument
//   node scripts/decide/mutants.ts --anchors       # check every anchor, run nothing
// A mutant whose anchor is missing, or occurs more than once, is a failure: fix its anchor. A
// mutant that survives is a test that cannot fail: kill it, or justify it as equivalent here.
// Only an assertion failure kills. A mutant under which a test throws any other error, a suite does
// not load or a test times out is a run error, not a kill, and the run fails. Every run first
// applies a comment-only canary that must survive and a deliberate break that must be killed, and
// a run with no mutant selected fails: scripts/mutation.ts.
// Equivalent, so not listed: the example importer's own capture-failure class, because import makes
// the same change (decision 0011).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type Outcome, runMutations, runTests } from "../mutation.ts";

interface Mutant {
  readonly id: string;
  /** The file, relative to packages/ichnaea. */
  readonly file: string;
  readonly from: string;
  readonly to: string;
  /** The test projects that must detect it; the decide project when absent. */
  readonly projects?: readonly string[];
}

const D = "src/decide/decide.ts";
const P = "src/decide/plugin.ts";
const PL = "src/decide/planning.ts";
const CORE = ["core", "decide", "report", "example-support-assistant"];
export const MUTANTS: readonly Mutant[] = [
  // Record checks: INVALID.
  {
    id: "budget_exceeded trial ignored",
    file: D,
    from: 'input.trials.some((t) => t.outcome === "budget_exceeded")',
    to: "false",
  },
  {
    id: "monthly budget ignored",
    file: D,
    from: "plan.budget.worstCaseCalls > plan.budget.monthlyRemaining",
    to: "false",
  },
  {
    id: "verifyArms ignored",
    file: D,
    from: "for (const error of verifyArms(plan.arms))",
    to: "for (const error of [] as ReturnType<typeof verifyArms>)",
  },
  {
    id: "base without values allowed",
    file: D,
    from: 'invalid.push("the base arm has no trial with a value");',
    to: "void 0;",
  },
  {
    id: "decision without arms allowed",
    file: D,
    from: 'invalid.push("a decision needs a base and a candidate arm");',
    to: "void 0;",
  },
  {
    id: "decision without primary allowed",
    file: D,
    from: 'invalid.push("a decision needs a primary measure");',
    to: "void 0;",
  },
  {
    id: "second candidate allowed",
    file: D,
    from: 'if (plan.arms.filter((a) => a.role === "candidate").length > 1)',
    to: "if (false)",
  },
  { id: "duplicates allowed", file: D, from: "  invalid.push(...recordProblems(input));", to: "" },
  {
    id: "gate consistency ignored",
    file: D,
    from: "    if (g.passed === g.failures > 0)\n      invalid.push(",
    to: "    if (false)\n      invalid.push(",
  },
  {
    id: "gate without result allowed",
    file: D,
    from: "    if (!input.gates.some((g) => g.gate === id))",
    to: "    if (false)",
  },
  {
    id: "unplanned trial allowed",
    file: D,
    from: "  if (unplannedTrial) invalid.push(",
    to: "  if (false) invalid.push(",
  },
  {
    id: "margin check off",
    file: D,
    from: "    if (!(p.margin < 1 && (p.safetyMargin ?? 0) <= p.margin))\n      invalid.push(",
    to: "    if (false)\n      invalid.push(",
  },
  {
    id: "proportion check removed",
    file: D,
    from: "const problem = v.applicable && v.value ? proportionProblem(v.value) : undefined;",
    to: "const problem = undefined as string | undefined;",
  },
  {
    id: "unsupported value allowed",
    file: D,
    from: "if (decision && t.unsupported) invalid.push(t.unsupported);",
    to: "",
  },
  {
    id: "coverage over every arm",
    file: D,
    from: "  const compared = pair ? [pair.base, pair.candidate] : plan.arms.map((a) => a.name as string);",
    to: "  const compared = plan.arms.map((a) => a.name as string);",
  },
  // Arms that differ beyond the trigger (REQ-15).
  {
    id: "trigger check off",
    file: D,
    from: "  if (pair) invalid.push(...triggerCheck(plan, pair, input.trials));",
    to: "",
  },
  {
    id: "trigger compares only models",
    file: D,
    from: "const undeclared = diffs.filter((d) => !allowed.has(d.part) && !declared.has(d.key));",
    to: 'const undeclared = diffs.filter((d) => d.part === "model" && !allowed.has(d.part));',
  },
  {
    id: "trigger ignores parameters",
    file: D,
    from: 'out.set(`parameter.${p.name}`, { value: canonicalize(p), part: "parameter" });',
    to: "void p;",
  },
  {
    id: "trigger ignores declarations",
    file: D,
    from: "const undeclared = diffs.filter((d) => !allowed.has(d.part) && !declared.has(d.key));",
    to: "const undeclared = diffs.filter((d) => !allowed.has(d.part));",
  },
  {
    id: "trigger ignores observations",
    file: D,
    from: "const same = values.size === other.size && [...values].every((v) => other.has(v));",
    to: "const same = true;",
  },
  {
    id: "advice omitted from the reason",
    file: D,
    from: "${howToAllow(plan, undeclared)}",
    to: "",
  },
  {
    id: "advice names no trigger",
    file: D,
    from: "        .filter(([, parts]) => parts?.includes(part))",
    to: "        .filter(() => false)",
  },
  {
    id: "advice offers --vary where it is refused",
    file: D,
    from: "const canVary = TRIGGER_VARIES[plan.trigger] !== null;",
    to: "const canVary = true;",
  },
  {
    id: "advice never offers --vary",
    file: D,
    from: "      ...(canVary ? [`--vary ${key}`] : []),",
    to: "      ...[],",
  },
  {
    id: "advice counts one difference as many",
    file: D,
    from: 'advice.length > 1 ? "them" : "it"',
    to: '"them"',
  },
  {
    id: "trigger lets a case-set change vary the system",
    file: "src/core/planner.ts",
    from: '  "case-set": null,',
    to: '  "case-set": [],',
    projects: CORE,
  },
  // One trial per case and arm (VALIDATION.md, "One trial per case").
  {
    id: "one trial: the coin always runs the base first",
    file: "src/contracts/pair-order.ts",
    from: "  return (firstByte & 1) === 1;",
    to: "  return false;",
    projects: ["core", "decide"],
  },
  {
    id: "the planner ignores the coin",
    file: "src/core/planner.ts",
    from: "        ? candidateRunsFirst(seed, c.id, replicate)",
    to: "          ? false",
    projects: CORE,
  },
  {
    id: "one trial: decide ignores the coin's order",
    file: D,
    from: "if (startOf(second) < startOf(first) || Math.abs(rb - rc) > 2 * c - 1) unpaired.add(id);",
    to: "if (Math.abs(rb - rc) > 2 * c - 1) unpaired.add(id);",
  },
  {
    id: "one trial: the rank rule off",
    file: D,
    from: "if (startOf(second) < startOf(first) || Math.abs(rb - rc) > 2 * c - 1) unpaired.add(id);",
    to: "if (startOf(second) < startOf(first)) unpaired.add(id);",
  },
  {
    id: "one trial: the rank rule one rank wider",
    file: D,
    from: "if (startOf(second) < startOf(first) || Math.abs(rb - rc) > 2 * c - 1) unpaired.add(id);",
    to: "if (startOf(second) < startOf(first) || Math.abs(rb - rc) > 2 * c) unpaired.add(id);",
  },
  {
    id: "one trial: the rank rule ignores the concurrency",
    file: D,
    from: "    const c = concurrencyOf(times.values());",
    to: "    const c = 1;",
  },
  {
    id: "one trial: a lost pair still counts",
    file: D,
    from: "      (side !== undefined && unpaired.has(planned.case))",
    to: "      false",
  },
  {
    id: "one trial: missing times allowed",
    file: D,
    from: "  if (times.size < ran.length) limitations.push(NO_TIMES);",
    to: "  if (false) limitations.push(NO_TIMES);",
  },
  {
    id: "one trial: the schedule is not needed",
    file: D,
    from: "  if (plan.schedule === undefined)\n    limitations.push(",
    to: "  if (false)\n    limitations.push(",
  },
  {
    id: "one trial: every plan waives the A/A precondition",
    file: D,
    from: "  if (identity(pair.base) !== identity(pair.candidate))",
    to: "  if (false)",
  },
  {
    id: "a/a: one decision is enough",
    file: D,
    from: "  if (cited.size < 2)",
    to: "  if (cited.size < 1)",
  },
  {
    id: "a/a: the cited digest unchecked",
    file: D,
    from: "    if (digest(e.decision) !== cite)",
    to: "    if (false)",
  },
  {
    id: "a/a: a REGRESSION allowed",
    file: D,
    from: '    if (primaries.some((m) => m.verdict === "REGRESSION"))\n      fail(',
    to: "    if (false)\n      fail(",
  },
  {
    id: "a/a: another suite allowed",
    file: D,
    from: "    if (e.plan.suiteDigest !== plan.suiteDigest)",
    to: "    if (false)",
  },
  {
    id: "a/a: another model allowed",
    file: D,
    from: "    if (baseModels(e.plan) !== baseModels(plan))",
    to: "    if (false)",
  },
  {
    id: "a/a: another schedule allowed",
    file: D,
    from: "      canonicalize(e.plan.schedule ?? null) !== canonicalize(plan.schedule)",
    to: "      false",
  },
  {
    id: "one trial: stats validates without the checks",
    file: "src/stats/compare.ts",
    from: "  if (checks === undefined) return [ONE_TRIAL_NEEDS_CHECKS];",
    to: "  if (checks === undefined) return [];",
    projects: ["stats", "decide"],
  },
  {
    id: "one trial: stats validates non-inferiority",
    file: "src/stats/compare.ts",
    from: "        ...(oneTrial ? [NON_INFERIORITY_AT_ONE_TRIAL] : []),",
    to: "        ...[],",
    projects: ["stats", "decide"],
  },
  // Outcome classes (REQ-20).
  {
    id: "system failure scored by its value",
    file: D,
    from: "    if (FAILED.has(outcome)) {",
    to: "    if (false) {",
  },
  {
    id: "contradicting records allowed",
    file: D,
    from: "  if (first)\n    invalid.push(",
    to: "  if (false)\n    invalid.push(",
  },
  {
    id: "invalid configuration not missing",
    file: D,
    from: '  "not_run",\n  "invalid_configuration",\n',
    to: '  "not_run",\n',
  },
  {
    id: "not applicable counted as planned",
    file: D,
    from: "      av.notApplicable++;\n      continue;",
    to: "      av.notApplicable++;\n      av.planned++;\n      continue;",
  },
  {
    id: "import keeps a passing system failure",
    file: "src/core/import.ts",
    from: "    if (FAILED_OUTCOMES.has(outcome) && passing(v.value))",
    to: "    if (false)",
    projects: CORE,
  },
  {
    id: "import scores a lost capture",
    file: "src/core/import.ts",
    from: "    return checkCaptured(checkConfiguration(t, identities.get(p.arm)));",
    to: "    return checkConfiguration(t, identities.get(p.arm));",
    projects: CORE,
  },
  // The sensitivity analysis (decision 0010).
  {
    id: "sensitivity only when missing counts differ",
    file: D,
    from: "  const missesTrials = plan.primary.some((p) => missesOwnTrials(p.measure));",
    to: "  const missesTrials =\n    pair !== undefined &&\n    plan.primary.some(\n      (p) =>\n        tallies.get(p.measure)?.arms.get(pair.base)?.missing !==\n        tallies.get(p.measure)?.arms.get(pair.candidate)?.missing,\n    );",
  },
  {
    id: "sensitivity only when the candidate misses",
    file: D,
    from: "    [pair.base, pair.candidate].some(\n      (arm) => (tallies.get(measure)?.arms.get(arm)?.missing ?? 0) > 0,",
    to: "    [pair.candidate].some(\n      (arm) => (tallies.get(measure)?.arms.get(arm)?.missing ?? 0) > 0,",
  },
  {
    id: "sensitivity never changes a verdict",
    file: D,
    from: "      if (changesNi || changesReg) changed.add(id);",
    to: "",
  },
  {
    id: "sensitivity imputes nothing",
    file: D,
    from: "      if (imputed === undefined) continue;",
    to: "      continue;",
  },
  {
    id: "sensitivity does not test REGRESSION",
    file: D,
    from: 'const changesReg = v.verdict === "REGRESSION" && reg.verdict !== "REGRESSION";',
    to: "const changesReg = false;",
  },
  {
    id: "sensitivity imputes missing base trials as failures against non-inferiority",
    file: D,
    from: "const AGAINST_NON_INFERIORITY: Imputation = { base: true, candidate: false };",
    to: "const AGAINST_NON_INFERIORITY: Imputation = { base: false, candidate: false };",
  },
  // Verdict order, scope and reasons (decision 0011).
  {
    id: "failed gate ignored",
    file: D,
    from: "  } else if (failedGate) {",
    to: "  } else if (false) {",
  },
  {
    id: "estimate-only before a failed gate",
    file: D,
    from: "  } else if (failedGate) {",
    to: "  } else if (failedGate && decision) {",
  },
  {
    id: "exploratory run decides",
    file: D,
    from: 'const decision = plan.mode === "decision" && !run.exploratory;',
    to: 'const decision = plan.mode === "decision";',
  },
  {
    id: "scope always claims run-to-run noise",
    file: D,
    from: 'scope: `on these ${cases} cases${noise ? ", beyond run-to-run noise" : ""}`,',
    to: "scope: `on these ${cases} cases, beyond run-to-run noise`,",
  },
  {
    id: "noise claimed without 2 trials per case and arm",
    file: D,
    from: "    if (c.base.trials < 2 || c.candidate.trials < 2) return false;",
    to: "",
  },
  {
    id: "the regression reason always claims noise",
    file: D,
    from: 'dropped${noise ? " beyond run-to-run noise" : ""} and is not shown non-inferior.',
    to: "dropped beyond run-to-run noise and is not shown non-inferior.",
    projects: CORE,
  },
  {
    id: "the non-inferiority note always claims noise",
    file: D,
    from: '${replicated(cases) ? "beyond run-to-run noise" : "significant"}',
    to: "beyond run-to-run noise",
  },
  {
    id: "INVALID claims a scope",
    file: D,
    from: '  if (verdict === "INVALID") return { scope: "no claim: the records fail a check", cases };',
    to: "",
  },
  {
    id: "scope counts every case of the plan",
    file: D,
    from: "  const cases = compared.size > 0 ? compared.size : new Set(plan.trials.map((t) => t.case)).size;",
    to: "  const cases = new Set(plan.trials.map((t) => t.case)).size;",
  },
  {
    id: "PASS by falling through",
    file: D,
    from: 'primaries.length > 0 && primaries.every((m) => m.verdict === "NON-INFERIOR")',
    to: "true",
  },
  // Per-measure verdicts and multiplicity (REQ-51).
  {
    id: "unvalidated comparison decides",
    file: D,
    from: "      if (!comparison.regression.validated) {",
    to: "      if (false) {",
  },
  // Two validity results (decision 0015).
  {
    id: "validity: PASS from regression.validated alone",
    file: D,
    from: "      if (!comparison.nonInferiority.validated) {",
    to: "      if (false) {",
  },
  {
    id: "validity: REGRESSION gate reads nonInferiority.validated",
    file: D,
    from: "      if (!comparison.regression.validated) {",
    to: "      if (!comparison.nonInferiority.validated) {",
  },
  {
    id: "validity: Holm family over non-inferiority validity",
    file: D,
    from: "    ([, v]) => v.comparison?.regression.validated === true,",
    to: "    ([, v]) => v.comparison?.nonInferiority.validated === true,",
  },
  {
    id: "validity: the record copies the regression result into nonInferiority",
    file: D,
    from: "  return { regression: recorded(c.regression), nonInferiority: recorded(c.nonInferiority) };",
    to: "  return { regression: recorded(c.regression), nonInferiority: recorded(c.regression) };",
  },
  {
    id: "validity: the floor's plain reason dropped",
    file: D,
    from: "      open.length > 0 && open.every((o) => o.cause.onlyTheFloor)",
    to: "      false",
    projects: CORE,
  },
  {
    id: "validity: the floor reason ignores the bound",
    file: D,
    from: "  if (!c?.regression.validated || !(c.difference.lower > -effective)) return false;",
    to: "  if (!c?.regression.validated) return false;",
  },
  {
    id: "validity: the floor reason ignores the imputation against non-inferiority",
    file: D,
    from: "    if (imputed === undefined || onlyTheFloor(imputed.comparison, effective))",
    to: "    if (true)",
  },
  {
    id: "validity: a bound that does not clear the margin hides the floor",
    file: D,
    from: '    return `the cases cannot tell yet${unvalidated ? `, and ${unvalidated}` : ""}`;',
    to: "    return `the cases cannot tell yet`;",
  },
  {
    id: "validity: the reason names one measure's cause only",
    file: D,
    from: "  if (parts.length === 1 && only)",
    to: "  if (only)",
  },
  {
    id: "missing trials are named for a measure that misses none",
    file: D,
    from: '      s.missesOwnTrials\n        ? `${many ? "their" : "its"} missing trials`',
    to: '      true\n        ? `${many ? "their" : "its"} missing trials`',
  },
  {
    id: "missing trials in the note are named for a measure that misses none",
    file: D,
    from: '`imputing ${missesOwnTrials(id) ? "its missing trials"',
    to: '`imputing ${true ? "its missing trials"',
  },
  {
    id: "validity: the floor's plain reason hides another limitation",
    file: D,
    from: "  return limitations.length === 1 && limitations[0] === MARGIN_FLOOR_NOT_SET;",
    to: "  return limitations.length > 0;",
  },
  {
    id: "validity: report does not label an interval that is not validated",
    file: "src/report/view.ts",
    from: '${nonInferiority.validated ? "" : ` ${NOT_VALIDATED}`}',
    to: "",
    projects: CORE,
  },
  {
    id: "validity: report labels by the regression result",
    file: "src/report/view.ts",
    from: "                ...differenceCells(comparison.difference, comparison.nonInferiority),",
    to: "                ...differenceCells(comparison.difference, comparison.regression),",
    projects: CORE,
  },
  {
    id: "validity: lint misses an unlabelled bound",
    file: "src/report/render.ts",
    from: '  if (cells.get("validated") === "false" && !unavailable && !bound.endsWith(NOT_VALIDATED))',
    to: "  if (false)",
    projects: CORE,
  },
  {
    id: "NI at the bound",
    file: D,
    from: "const nonInferior = comparison.difference.lower > -effective;",
    to: "const nonInferior = comparison.difference.lower >= -effective;",
  },
  {
    id: "safety margin ignored",
    file: D,
    from: "    const effective = p.margin - (p.safetyMargin ?? 0);\n    if (!(effective >= 0 && p.margin < 1)) {",
    to: "    const effective = p.margin;\n    if (!(effective >= 0 && p.margin < 1)) {",
  },
  {
    id: "REGRESSION ignores non-inferiority",
    file: D,
    from: '    if (v.verdict !== "NON-INFERIOR") {',
    to: "    if (true) {",
  },
  {
    id: "Holm replaced by raw p-values",
    file: D,
    from: "const pAdjusted = holm(",
    to: "const pAdjusted = ((x: number[]) => x)(",
  },
  {
    id: "Holm over unvalidated comparisons too",
    file: D,
    from: "    ([, v]) => v.comparison?.regression.validated === true,",
    to: "    ([, v]) => v.comparison !== undefined,",
  },
  {
    id: "Holm boundary",
    file: D,
    from: "    if (pa > input.alpha) {",
    to: "    if (pa >= input.alpha) {",
  },
  {
    id: "non-inferiority at alpha over the number of measures",
    file: D,
    from: "        alpha: input.alpha,\n        margin: effective,",
    to: "        alpha: input.alpha / input.measures.length,\n        margin: effective,",
  },
  {
    id: "secondary measures tested",
    file: D,
    from: 'const result = tier === "primary" ? tested?.get(id) : undefined;',
    to: "const result = tested?.get(id) ?? tested?.values().next().value;",
  },
  // Intervals on every difference (REQ-129).
  {
    id: "descriptive difference without an interval",
    file: D,
    from: "      comparison: { ...common, difference: estimateOf(c.difference), ...validityOf(c) },",
    to: "      comparison: {\n        ...common,\n        difference: rateDifference(t, pair.base, pair.candidate, 1 - plan.alpha),\n        ...validityOf(c),\n      },",
  },
  {
    id: "report lint misses an estimate without its interval",
    file: "src/report/render.ts",
    from: "    if (problem) problems.push(`an estimate without its interval: ${problem}`);",
    to: "    void problem;",
    projects: CORE,
  },
  {
    id: "report lint decodes entities in the wrong order",
    file: "src/report/render.ts",
    from: '  text\n    .replaceAll("&quot;", \'"\')',
    to: '  text\n    .replaceAll("&amp;", "&")\n    .replaceAll("&quot;", \'"\')',
    projects: CORE,
  },
  {
    id: "report n column shows planned only",
    file: "src/report/view.ts",
    from: "n: `${a.availability.available} of ${a.availability.planned}`,",
    to: "n: `${a.availability.planned}`,",
    projects: CORE,
  },
  {
    id: "flip threshold",
    file: D,
    from: "if (b > 0.5 && k < 0.5)",
    to: "if (b > 0.5 && k <= 0.5)",
  },
  // The power statement (decision 0017).
  {
    id: "decide keeps an empty planning statement",
    file: D,
    from: "      planning: planningOf(plan),",
    to: "      planning: plan.power,",
  },
  {
    id: "planning: the not-computed entries dropped",
    file: D,
    from: "  if (power && power.length > 0) return power;",
    to: "  return power ?? [];",
  },
  {
    id: "planning: the refusal text dropped",
    file: D,
    from: "      : { ...common, reason: REFUSED_MARGIN, refusal: refuse };",
    to: '      : { ...common, reason: REFUSED_MARGIN, refusal: "the margin is refused" };',
  },
  {
    id: "planning: the refused reason used for an uncomputable plan",
    file: D,
    from: '          reason: "the plan carries no planning statement, and none can be computed from it",',
    to: '          reason: REFUSED_MARGIN,\n          refusal: "no statement",',
  },
  {
    id: "power: INVALID runs the simulation",
    file: D,
    from: '    if (invalid) return { computed: false, ...common, reason: "run invalid" };',
    to: "",
  },
  {
    id: "power: the run-time MDE decides the mode",
    file: D,
    from: "  } else if (!decision) {",
    to: "  } else if (\n    !decision ||\n    runPower(plan, tallies, pair?.base, false).some((e) => e.computed && !e.decidable)\n  ) {",
  },
  {
    id: "power: an entry not computed names the wrong reason",
    file: D,
    from: '        reason: "fixed-cases needs at least 2 trials per case and arm",',
    to: '        reason: "no applicable case with a base value",',
  },
  {
    id: "power: run-time margin within reach forced",
    file: D,
    from: "      decidable: mde <= effective,",
    to: "      decidable: true,",
  },
  {
    id: "power: planning floor ignored",
    file: PL,
    from: "    const decidable = floor < effective;",
    to: "    const decidable = true;",
  },
  {
    id: "power: an estimate-only plan has no planning statement",
    file: PL,
    from: "  if (counts.length === 0) return {};",
    to: '  if (counts.length === 0 || plan.mode !== "decision") return {};',
    projects: CORE,
  },
  {
    id: "power: an estimate-only plan gets the floor's mode reasons",
    file: PL,
    from: '  return reasons.length > 0 && plan.mode === "decision"',
    to: "  return reasons.length > 0",
  },
  {
    id: "power: import is silent about a plan without a statement",
    file: "src/core/cli.ts",
    from: "  if (result.plan.power.length === 0 && result.plan.primary.length > 0)",
    to: "  if (false)",
    projects: CORE,
  },
  // Margins (decision 0012).
  {
    id: "margin: floor not checked",
    file: PL,
    from: "      tested < VALIDATED_MARGIN_FLOOR",
    to: "      tested < 0",
  },
  {
    id: "margin: floor boundary",
    file: PL,
    from: "      tested < VALIDATED_MARGIN_FLOOR",
    to: "      tested <= VALIDATED_MARGIN_FLOOR",
  },
  {
    id: "margin: ceiling not checked",
    file: PL,
    from: "        : tested > VALIDATED_MARGIN_CEILING",
    to: "        : tested > 1",
  },
  {
    id: "margin: ceiling boundary",
    file: PL,
    from: "        : tested > VALIDATED_MARGIN_CEILING",
    to: "        : tested >= VALIDATED_MARGIN_CEILING",
  },
  {
    id: "margin: the declared margin is checked, not the effective one",
    file: PL,
    from: "    const tested = p.margin - (p.safetyMargin ?? 0);",
    to: "    const tested = p.margin;",
  },
  {
    id: "margin: placeholders exempt from the range",
    file: PL,
    from: '  for (const p of plan.estimand === "fixed-cases" ? plan.primary : []) {',
    to: '  for (const p of plan.estimand === "fixed-cases"\n    ? plan.primary.filter((x) => x.marginStatus === "registered")\n    : []) {',
  },
  {
    id: "margin: range applied under sampled-cases",
    file: PL,
    from: '  for (const p of plan.estimand === "fixed-cases" ? plan.primary : []) {',
    to: "  for (const p of plan.primary) {",
  },
  {
    id: "margin: placeholder in decision mode allowed",
    file: D,
    from: '    if (plan.mode === "decision" && p.marginStatus === "placeholder")',
    to: "    if (false)",
  },
  {
    id: "margin: placeholder plans decide",
    file: "src/core/planner.ts",
    from: '    if (primary.marginStatus === "placeholder")',
    to: "    if (false)",
    projects: CORE,
  },
  // The monthly call ledger (REQ-86): no corrupt line can lower the month's total.
  {
    id: "ledger: calls unchecked",
    file: "src/core/ledger.ts",
    from: "const LedgerLine = z.looseObject({ run: z.string(), calls: z.int().min(0) });",
    to: "const LedgerLine = z.looseObject({ run: z.string(), calls: z.unknown() });",
    projects: ["core"],
  },
  {
    id: "ledger: negative calls accepted",
    file: "src/core/ledger.ts",
    from: "const LedgerLine = z.looseObject({ run: z.string(), calls: z.int().min(0) });",
    to: "const LedgerLine = z.looseObject({ run: z.string(), calls: z.int() });",
    projects: ["core"],
  },
  // The planner's other refusals and the CI policy.
  {
    id: "planner allows a composite primary",
    file: "src/core/planner.ts",
    from: "    if (measure.card.composite === true)",
    to: "    if (false)",
    projects: CORE,
  },
  {
    id: "planner allows a secondary card as primary",
    file: "src/core/planner.ts",
    from: '    if (measure.card.tier !== "primary")',
    to: "    if (false)",
    projects: CORE,
  },
  {
    id: "INVALID maps to the policy",
    file: P,
    from: '  if (decision.verdict === "INVALID") return 1;',
    to: "",
  },
];

const ichnaea = join(import.meta.dirname, "..", "..");
const repository = join(ichnaea, "..", "..");
const anchorsOnly = process.argv.includes("--anchors");
const wanted = process.argv.slice(2).filter((a) => a !== "--anchors");
/**
 * The canary: a change to a comment, which no test can detect, run against every project that any
 * mutant runs. It runs first and must survive. A killed canary means some test fails whatever the
 * mutant does, and then every kill is vacuous.
 */
export const CANARY: Mutant = {
  id: "canary: a comment only",
  file: D,
  from: "/** Everything a decision is computed from. Reports never compute anything new. */",
  to: "/** Everything a decision is computed from. Reports never compute anything new (the mutation canary). */",
  projects: [...new Set(MUTANTS.flatMap((m) => m.projects ?? ["decide"]))],
};

/**
 * The control: a release that every primary passes reads INCONCLUSIVE, which the decide tests
 * assert. It runs second and must be killed; otherwise this run cannot show a kill.
 */
export const CONTROL: Mutant = {
  id: "control: PASS read as INCONCLUSIVE",
  file: D,
  from: '    verdict = "PASS";',
  to: '    verdict = "INCONCLUSIVE";',
};

const selected = MUTANTS.filter(
  (x) => wanted.length === 0 || wanted.some((w) => x.id.startsWith(w)),
);
const anchorCount = (m: Mutant): number =>
  readFileSync(join(ichnaea, m.file), "utf8").split(m.from).length - 1;
if (anchorsOnly) {
  const all = [CANARY, CONTROL, ...selected];
  const broken = all.filter((m) => anchorCount(m) !== 1);
  for (const m of broken)
    console.log(`${m.id}: anchor found ${anchorCount(m)} times in ${m.file} (fix the mutant)`);
  console.log(
    `${all.length - broken.length} of ${all.length} anchors found once, the controls' included`,
  );
  console.log(
    broken.length === 0 ? "all anchors found" : `failed: ${broken.map((m) => m.id).join(", ")}`,
  );
  process.exitCode = broken.length === 0 ? 0 : 1;
} else {
  const attempt = (m: Mutant): Outcome => {
    const count = anchorCount(m);
    if (count !== 1)
      return { kind: "error", reason: `anchor found ${count} times in ${m.file} (fix the mutant)` };
    const path = join(ichnaea, m.file);
    const original = readFileSync(path, "utf8");
    writeFileSync(path, original.replace(m.from, m.to));
    try {
      return runTests(repository, m.projects ?? ["decide"], m.id);
    } finally {
      writeFileSync(path, original);
    }
  };
  process.exitCode = runMutations({
    canary: CANARY,
    control: CONTROL,
    mutants: selected,
    attempt,
  }).code;
}
