import {
  canonicalize,
  type Configuration,
  Decision,
  digest,
  FactorPart,
  type GateResult,
  type MeasuredValue,
  type MeasureValue,
  type Plan,
  proportionProblem,
  type Run,
  type Trial,
  verifyArms,
} from "@hephaestus-build/ichnaea-contracts";
import { recordProblems, TRIGGER_VARIES } from "@hephaestus-build/ichnaea-core";
import {
  type CaseCounts,
  type Comparison,
  type ComparisonInput,
  compareCounts,
  createRng,
  EstimandError,
  fixedCasesMde,
  holm,
  MARGIN_FLOOR_NOT_SET,
  sampledCasesFloor,
  type ValueType,
  wilson,
} from "@hephaestus-build/ichnaea-stats";
import type * as z from "zod";

/** Everything a decision is computed from. Reports never compute anything new. */
export interface DecideInput {
  readonly plan: Plan;
  readonly run: Run;
  readonly trials: readonly Trial[];
  readonly values: readonly MeasureValue[];
  readonly gates: readonly GateResult[];
  readonly decidedAt: string;
  readonly ichnaea: string;
}

type DecisionInput = z.input<typeof Decision>;
type MeasureResult = DecisionInput["measures"][number];
type ComparisonResult = MeasureResult["comparisons"][number];
type SensitivityResult = MeasureResult["sensitivity"][number];
type PowerEntry = DecisionInput["power"]["run"][number];
type ValidityResult = ComparisonResult["regression"];

/**
 * The comparison of one measure's counts. Every decision uses `compareCounts`; a test of the rule
 * may pass results of its own (`decideWith`, `decidePrimariesWith`).
 */
export type Compare = (input: ComparisonInput) => Comparison;
type FactorPartName = z.infer<typeof FactorPart>;

/** Outcomes that leave a planned trial without a value: they are missing, never a failure. */
const MISSING = new Set(["infrastructure_failure", "not_run", "invalid_configuration"]);
/**
 * Outcomes that score as a failed trial on a binary measure whatever value a record carries
 * (REQ-20): the system failed, so the trial cannot pass.
 */
const FAILED = new Set(["system_failure", "budget_exceeded"]);
const DEFAULT_COVERAGE_FLOOR = 0.9;

/**
 * The reason of an INCONCLUSIVE run whose measures did not regress while the validated margin
 * floor is not set (decision 0015). Today an unchanged candidate gets it, so it must not read as a
 * broken setup.
 */
export const FLOOR_NOT_SET_REASON =
  "No primary measure regressed, but no candidate can PASS yet: the validated margin floor for non-inferiority is not set.";
/** The statistics package's name for a value type. A type it has no name for has no method. */
const STATS_VALUE_TYPE: Partial<Record<MeasuredValue["type"], ValueType>> = {
  binary: "binary",
  proportion: "proportion",
  score: "score",
  level: "ordinal",
};
const NAN = { nonFinite: "nan" } as const;
const NEG_INF = { nonFinite: "-inf" } as const;
const POS_INF = { nonFinite: "inf" } as const;

interface Availability {
  planned: number;
  available: number;
  notApplicable: number;
  missing: number;
  successes: number;
  trials: number;
}

/** One measure's binary counts per case for the compared arms, and availability per arm. */
interface Tally {
  readonly cases: Map<string, CaseCounts>;
  readonly arms: Map<string, Availability>;
  /** A value whose type the decision rule cannot use, if any. */
  readonly unsupported?: string;
  /** The type of the measure's values in these records; binary when it has none. */
  readonly valueType: MeasuredValue["type"];
}

/** The outcome a missing trial is given in one arm, for the sensitivity analysis. */
interface Imputation {
  readonly base: boolean;
  readonly candidate: boolean;
}

/** Works against non-inferiority: missing candidate trials fail, missing base trials pass. */
const AGAINST_NON_INFERIORITY: Imputation = { base: true, candidate: false };
/** Works against regression: missing candidate trials pass, missing base trials fail. */
const AGAINST_REGRESSION: Imputation = { base: false, candidate: true };

/** Planned trials per case in one arm (a suite can give some cases more, `replicatesFor`). */
export function plannedTrialsPerCase(plan: Plan, arm: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of plan.trials) if (t.arm === arm) counts.set(t.case, (counts.get(t.case) ?? 0) + 1);
  return counts;
}

/** "2 (43 cases), 3 (17 cases)": the trial counts per case and arm, for power statements. */
export function describeCounts(counts: readonly number[]): string {
  const by = new Map<number, number>();
  for (const c of counts) by.set(c, (by.get(c) ?? 0) + 1);
  return [...by.entries()]
    .toSorted(([a], [b]) => a - b)
    .map(([r, n]) => `${r} (${n} case${n === 1 ? "" : "s"})`)
    .join(", ");
}

function seedOf(plan: Plan): number {
  return Number((BigInt(plan.seed.value) % 4294967295n) + 1n);
}

const emptyAvailability = (): Availability => ({
  planned: 0,
  available: 0,
  notApplicable: 0,
  missing: 0,
  successes: 0,
  trials: 0,
});

/** Whether a value says that its trial passed: a binary pass, or a proportion with a success. */
function passing(value: MeasureValue["value"]): boolean {
  return (
    (value?.type === "binary" && value.pass) ||
    (value?.type === "proportion" && value.successes > 0)
  );
}

/**
 * Collects one measure's counts. A system failure or a budget overrun is a failed trial. A missing
 * trial (an infrastructure failure, including a capture failure, a trial not run, an invalid
 * configuration, or a trial without a value) is left out, unless an imputation gives it an outcome
 * for the sensitivity analysis.
 */
function tally(
  plan: Plan,
  trials: ReadonlyMap<string, Trial>,
  values: ReadonlyMap<string, MeasureValue>,
  measure: string,
  arms: { readonly base: string; readonly candidate: string } | undefined,
  imputation?: Imputation,
): Tally {
  const cases = new Map<string, CaseCounts>();
  const availability = new Map<string, Availability>();
  let unsupported: string | undefined;
  let valueType: MeasuredValue["type"] = "binary";
  for (const planned of plan.trials) {
    const av = availability.get(planned.arm) ?? emptyAvailability();
    availability.set(planned.arm, av);
    const value = values.get(`${measure}\u0000${planned.id}`);
    if (value && !value.applicable) {
      av.notApplicable++;
      continue;
    }
    av.planned++;
    const outcome = trials.get(planned.id)?.outcome ?? "not_run";
    const side =
      planned.arm === arms?.base
        ? "base"
        : planned.arm === arms?.candidate
          ? "candidate"
          : undefined;
    const v = value?.value;
    if (!MISSING.has(outcome) && v !== undefined && v.type !== "binary") {
      valueType = v.type;
      unsupported = `measure '${measure}' has a ${v.type} value; the decision rule decides binary values only (decision 0008)`;
      av.missing++;
      continue;
    }
    let pass: boolean;
    if (FAILED.has(outcome)) {
      pass = false;
      av.available++;
    } else if (MISSING.has(outcome) || v === undefined) {
      av.missing++;
      const imputed = side === undefined ? undefined : imputation?.[side];
      if (imputed === undefined) continue;
      pass = imputed;
    } else {
      pass = v.type === "binary" && v.pass;
      av.available++;
    }
    av.successes += pass ? 1 : 0;
    av.trials += 1;
    if (side === undefined) continue;
    const entry = cases.get(planned.case) ?? {
      id: planned.case,
      ...(planned.family === undefined ? {} : { family: planned.family }),
      base: { successes: 0, trials: 0 },
      candidate: { successes: 0, trials: 0 },
    };
    cases.set(planned.case, {
      ...entry,
      [side]: { successes: entry[side].successes + (pass ? 1 : 0), trials: entry[side].trials + 1 },
    });
  }
  return {
    cases,
    arms: availability,
    valueType,
    ...(unsupported === undefined ? {} : { unsupported }),
  };
}

function flipsOf(cases: ReadonlyMap<string, CaseCounts>): ComparisonResult["flips"] {
  const flips: ComparisonResult["flips"] = [];
  for (const c of cases.values()) {
    if (c.base.trials === 0 || c.candidate.trials === 0) continue;
    const b = c.base.successes / c.base.trials;
    const k = c.candidate.successes / c.candidate.trials;
    // The majority outcome counts; a tie is neither good nor bad, so it never flips.
    if (b > 0.5 && k < 0.5)
      flips.push({ case: c.id, direction: "negative", base: b, candidate: k });
    else if (b < 0.5 && k > 0.5)
      flips.push({ case: c.id, direction: "positive", base: b, candidate: k });
  }
  return flips.toSorted((x, y) =>
    x.direction === y.direction ? (x.case < y.case ? -1 : 1) : x.direction === "negative" ? -1 : 1,
  );
}

/**
 * The identity projection of a configuration as factor keys, each with its part: every model,
 * generation parameter, prompt (by digest) and factor. Two arms with the same keys and values have
 * the same identity.
 */
function identityFactors(
  config: Configuration | undefined,
): Map<string, { readonly value: string; readonly part: FactorPartName }> {
  const out = new Map<string, { value: string; part: FactorPartName }>();
  if (!config) return out;
  for (const m of config.models)
    out.set(`model.${m.role}`, { value: canonicalize(m), part: "model" });
  for (const p of config.parameters)
    out.set(`parameter.${p.name}`, { value: canonicalize(p), part: "parameter" });
  for (const p of config.prompts)
    out.set(`prompt.${p.name}`, { value: canonicalize([p.digest, p.status]), part: "prompt" });
  for (const [n, f] of Object.entries(config.factors))
    out.set(`factor.${n}`, { value: canonicalize(f), part: f.part });
  return out;
}

/** The factor keys in which two arms differ, with their parts, sorted by key. */
function differences(
  plan: Plan,
  base: string,
  candidate: string,
): Array<{ readonly key: string; readonly part: FactorPartName }> {
  const fb = identityFactors(plan.arms.find((a) => a.name === base)?.configuration);
  const fc = identityFactors(plan.arms.find((a) => a.name === candidate)?.configuration);
  return [...new Set([...fb.keys(), ...fc.keys()])]
    .filter((k) => fb.get(k)?.value !== fc.get(k)?.value)
    .toSorted()
    .map((key) => ({ key, part: (fb.get(key) ?? fc.get(key))?.part ?? "other" }));
}

/** The part an observation belongs to: the first segment of its dotted name, else `other`. */
function observationPart(name: string): FactorPartName {
  const head = name.split(".")[0] ?? "";
  return FactorPart.safeParse(head).data ?? "other";
}

/**
 * What a run can change to allow each undeclared difference: a trigger that varies its part, or
 * `--vary` for the factor. A trigger that varies nothing in the system takes no `--vary`.
 */
function howToAllow(
  plan: Plan,
  undeclared: ReadonlyArray<{ readonly key: string; readonly part: FactorPartName }>,
): string {
  const canVary = TRIGGER_VARIES[plan.trigger] !== null;
  const advice = undeclared.flatMap(({ key, part }) => {
    const options = [
      ...Object.entries(TRIGGER_VARIES)
        .filter(([, parts]) => parts?.includes(part))
        .map(([trigger]) => `--trigger ${trigger}`),
      ...(canVary ? [`--vary ${key}`] : []),
    ];
    const last = options.pop();
    return last === undefined
      ? []
      : [`${key}: ${options.length > 0 ? `${options.join(", ")} or ` : ""}${last}`];
  });
  return advice.length > 0
    ? `. To allow ${advice.length > 1 ? "them" : "it"}, use ${advice.join("; ")}`
    : "";
}

/**
 * REQ-15: arms may differ only in what the trigger varies by its kind and what the plan declares
 * as varied. This covers the whole identity projection (models, parameters, prompts, factors) and
 * the factors each arm's trials report: an observation present in both arms whose reported values
 * differ must belong to a part the change varies.
 */
function triggerCheck(
  plan: Plan,
  pair: { readonly base: string; readonly candidate: string },
  trials: readonly Trial[],
): string[] {
  const kinds = TRIGGER_VARIES[plan.trigger];
  const declared = new Set<string>(plan.varies);
  const problems: string[] = [];
  if (kinds === null && declared.size > 0)
    problems.push(
      `a ${plan.trigger} change varies nothing in the system, but the plan declares ${[...declared].join(", ")} as varied`,
    );
  const allowed = new Set<FactorPartName>(kinds ?? []);
  const may =
    kinds === null
      ? "may not vary the system at all"
      : `may vary only ${kinds.length > 0 ? `the ${kinds.join(" and ")} part and ` : ""}what the plan declares as varied`;
  const diffs = differences(plan, pair.base, pair.candidate);
  const undeclared = diffs.filter((d) => !allowed.has(d.part) && !declared.has(d.key));
  if (undeclared.length > 0)
    problems.push(
      `a ${plan.trigger} change ${may}, but the arms also differ in ${undeclared.map((d) => d.key).join(", ")}${howToAllow(plan, undeclared)}`,
    );
  // Observations may differ in the parts the change varies, including the parts of what it declares.
  const observable = new Set<FactorPartName>(allowed);
  for (const d of diffs) if (declared.has(d.key)) observable.add(d.part);
  const arms = new Map(plan.trials.map((t) => [t.id as string, t.arm as string]));
  const seen = new Map<string, Map<string, Set<string>>>([
    [pair.base, new Map()],
    [pair.candidate, new Map()],
  ]);
  for (const t of trials) {
    if (t.outcome === "invalid_configuration") continue;
    const side = seen.get(arms.get(t.id) ?? "");
    if (!side) continue;
    for (const o of t.observed ?? []) {
      const set = side.get(o.name) ?? new Set<string>();
      set.add(canonicalize(o.value));
      side.set(o.name, set);
    }
  }
  const base = seen.get(pair.base) as Map<string, Set<string>>;
  const candidate = seen.get(pair.candidate) as Map<string, Set<string>>;
  for (const [name, values] of [...base.entries()].toSorted(([a], [b]) => (a < b ? -1 : 1))) {
    const other = candidate.get(name);
    if (!other || observationPart(name) === "other" || observable.has(observationPart(name)))
      continue;
    const same = values.size === other.size && [...values].every((v) => other.has(v));
    if (!same)
      problems.push(
        `the arms' trials report different values of observed '${name}', which a ${plan.trigger} change ${may}`,
      );
  }
  return problems;
}

/** Checks of the records themselves. Each problem makes the run INVALID. */
async function recordChecks(input: DecideInput): Promise<string[]> {
  const { plan, run } = input;
  const invalid: string[] = [];
  const planDigest = await digest(plan);
  if (run.plan !== planDigest)
    invalid.push(`the run belongs to plan ${run.plan}, not to this plan (${planDigest})`);
  for (const error of await verifyArms(plan.arms))
    invalid.push(`stored configuration at ${error.path} does not match (${error.computed})`);
  const names = plan.arms.map((a) => a.name);
  if (new Set(names).size !== names.length) invalid.push("the plan has duplicate arm names");
  if (plan.arms.filter((a) => a.role === "base").length > 1)
    invalid.push("the plan has two base arms");
  if (plan.arms.filter((a) => a.role === "candidate").length > 1)
    invalid.push("the plan has more than one candidate arm, which is not supported yet (REQ-57)");
  const plannedIds = new Set(plan.trials.map((t) => t.id as string));
  if (plannedIds.size !== plan.trials.length) invalid.push("the plan has duplicate trial IDs");
  invalid.push(...recordProblems(input));
  const unplannedTrial = input.trials.find((t) => !plannedIds.has(t.id));
  if (unplannedTrial) invalid.push(`trial '${unplannedTrial.id}' is not in the plan`);
  const unplannedValue = input.values.find((v) => !plannedIds.has(v.trial));
  if (unplannedValue)
    invalid.push(`a value names trial '${unplannedValue.trial}', which is not in the plan`);
  for (const v of input.values) {
    const problem = v.applicable && v.value ? proportionProblem(v.value) : undefined;
    if (problem) invalid.push(`measure '${v.measure}' on trial '${v.trial}': ${problem}`);
  }
  // A failed trial that carries a passing value contradicts itself: the importer is wrong.
  const outcomes = new Map(input.trials.map((t) => [t.id as string, t.outcome]));
  const contradicting = input.values.filter(
    (v) => v.applicable && FAILED.has(outcomes.get(v.trial) ?? "") && passing(v.value),
  );
  const first = contradicting[0];
  if (first)
    invalid.push(
      `${contradicting.length} failed trial(s) carry a passing value, for example '${first.trial}' (${outcomes.get(first.trial)}) for '${first.measure}'; the records contradict themselves`,
    );
  for (const g of input.gates)
    if (g.passed === g.failures > 0)
      invalid.push(`gate '${g.gate}' says passed ${g.passed} with ${g.failures} failure(s)`);
  for (const id of plan.hardGates)
    if (!input.gates.some((g) => g.gate === id)) invalid.push(`hard gate '${id}' has no result`);
  if (plan.budget.worstCaseCalls > plan.budget.maxCalls)
    invalid.push(
      `the plan needs ${plan.budget.worstCaseCalls} calls, over the budget of ${plan.budget.maxCalls}`,
    );
  if (
    plan.budget.monthlyRemaining !== undefined &&
    plan.budget.worstCaseCalls > plan.budget.monthlyRemaining
  )
    invalid.push(
      `the plan needs ${plan.budget.worstCaseCalls} calls, over the ${plan.budget.monthlyRemaining} left this month`,
    );
  if (input.trials.some((t) => t.outcome === "budget_exceeded"))
    invalid.push("the run exhausted its budget");
  for (const p of plan.primary) {
    if (!(p.margin < 1 && (p.safetyMargin ?? 0) <= p.margin))
      invalid.push(
        `measure '${p.measure}': the margin must be below 1 and at least the safety margin`,
      );
    if (plan.mode === "decision" && p.marginStatus === "placeholder")
      invalid.push(
        `measure '${p.measure}': a placeholder margin gives no verdict, but the plan is in decision mode`,
      );
  }
  return invalid;
}

/** One primary measure's counts, as the decision rule reads them. */
export interface PrimaryCounts {
  readonly measure: string;
  readonly margin: number;
  readonly safetyMargin?: number;
  readonly valueType: MeasuredValue["type"];
  readonly cases: readonly CaseCounts[];
}

/** The verdict of one primary measure and how it was reached. */
export interface PrimaryVerdict {
  readonly verdict: "NON-INFERIOR" | "REGRESSION" | "INCONCLUSIVE";
  readonly comparison?: Comparison;
  /** The Holm-adjusted regression p-value, for a validated comparison. */
  readonly regressionPAdjusted?: number;
  /**
   * Why an INCONCLUSIVE measure is not non-inferior: the cases cannot tell, the comparison is
   * outside the validated domain, its non-inferiority result alone is not validated, or there is no
   * comparison.
   */
  readonly cause?: "cannot-tell" | "unvalidated" | "non-inferiority-unvalidated" | "no-comparison";
  readonly notes: readonly string[];
}

/** What `decidePrimaries` decides from. */
export interface PrimariesInput {
  readonly estimand: Plan["estimand"];
  readonly alpha: number;
  readonly seed: number;
  readonly measures: readonly PrimaryCounts[];
}

/** The limitations of a comparison's non-inferiority result that its regression result lacks. */
function nonInferiorityOnly(comparison: Comparison): string[] {
  const domain = new Set(comparison.regression.limitations);
  return comparison.nonInferiority.limitations.filter((l) => !domain.has(l));
}

/** Whether the unset margin floor alone keeps a measure from NON-INFERIOR. */
function onlyTheFloor(v: PrimaryVerdict | undefined): boolean {
  if (v?.cause !== "non-inferiority-unvalidated" || !v.comparison) return false;
  const limitations = nonInferiorityOnly(v.comparison);
  return limitations.length === 1 && limitations[0] === MARGIN_FLOOR_NOT_SET;
}

/**
 * Per-measure verdicts for the primary measures (DESIGN § 6.3, REQ-51, decision 0015):
 * NON-INFERIOR when both results of the comparison are validated and the one-sided lower bound
 * exceeds −(δ − s), each at the unadjusted level (intersection-union, so a PASS needs no
 * adjustment); otherwise REGRESSION when the regression result is validated and the regression test
 * rejects Δ ≥ 0 after Holm across the comparisons whose regression result is validated; otherwise
 * INCONCLUSIVE. Holm covers only the tests that can produce REGRESSION, and a comparison whose
 * regression result is not validated cannot (decision 0008), so it stays out of the family. Whether
 * a result is validated depends on the cases, trials and margin, not on the outcomes, so the family
 * still holds the error rate at α. The measures are decided in order with one generator from
 * `seed`, so the same counts give the same verdicts.
 */
export function decidePrimaries(input: PrimariesInput): Map<string, PrimaryVerdict> {
  return decidePrimariesWith(input, compareCounts);
}

/** `decidePrimaries` with the comparison given, so a test can decide from results of its own. */
export function decidePrimariesWith(
  input: PrimariesInput,
  compare: Compare,
): Map<string, PrimaryVerdict> {
  const verdicts = new Map<string, PrimaryVerdict>();
  const rng = createRng(input.seed);
  for (const p of input.measures) {
    const effective = p.margin - (p.safetyMargin ?? 0);
    if (!(effective >= 0 && p.margin < 1)) {
      // The run is INVALID for this already (recordChecks); no comparison can use the margin.
      verdicts.set(p.measure, {
        verdict: "INCONCLUSIVE",
        cause: "no-comparison",
        notes: ["the margin cannot be used"],
      });
      continue;
    }
    try {
      const valueType = STATS_VALUE_TYPE[p.valueType];
      if (valueType === undefined)
        throw new EstimandError(`a ${p.valueType} measure has no paired method`);
      const comparison = compare({
        estimand: input.estimand,
        valueType,
        cases: p.cases,
        alpha: input.alpha,
        margin: effective,
        rng,
      });
      const notValidated = nonInferiorityOnly(comparison).map(
        (l) => `the non-inferiority result is not validated: ${l}`,
      );
      if (!comparison.regression.validated) {
        verdicts.set(p.measure, {
          verdict: "INCONCLUSIVE",
          comparison,
          cause: "unvalidated",
          notes: [
            ...comparison.regression.limitations.map((l) => `outside the validated domain: ${l}`),
            ...notValidated,
          ],
        });
        continue;
      }
      if (!comparison.nonInferiority.validated) {
        verdicts.set(p.measure, {
          verdict: "INCONCLUSIVE",
          comparison,
          cause: "non-inferiority-unvalidated",
          notes: notValidated,
        });
        continue;
      }
      const nonInferior = comparison.difference.lower > -effective;
      verdicts.set(p.measure, {
        verdict: nonInferior ? "NON-INFERIOR" : "INCONCLUSIVE",
        comparison,
        ...(nonInferior ? {} : { cause: "cannot-tell" as const }),
        notes: [],
      });
    } catch (error) {
      if (!(error instanceof EstimandError)) throw error;
      verdicts.set(p.measure, {
        verdict: "INCONCLUSIVE",
        cause: "no-comparison",
        notes: [error.message],
      });
    }
  }
  const family = [...verdicts.entries()].filter(
    ([, v]) => v.comparison?.regression.validated === true,
  );
  const pAdjusted = holm(family.map(([, v]) => (v.comparison as Comparison).regressionP));
  family.forEach(([id, v], i) => {
    const pa = pAdjusted[i] as number;
    const comparison = v.comparison as Comparison;
    if (pa > input.alpha) {
      verdicts.set(id, { ...v, regressionPAdjusted: pa });
      return;
    }
    if (v.verdict !== "NON-INFERIOR") {
      const { cause: _cause, ...rest } = v;
      verdicts.set(id, { ...rest, verdict: "REGRESSION", regressionPAdjusted: pa });
    } else
      verdicts.set(id, {
        ...v,
        regressionPAdjusted: pa,
        notes: [
          ...v.notes,
          `a drop smaller than the margin is beyond run-to-run noise: compatible with a drop of up to ${(Math.abs(comparison.difference.lower) * 100).toFixed(1)} points`,
        ],
      });
  });
  return verdicts;
}

function primaryVerdicts(
  plan: Plan,
  tallies: ReadonlyMap<string, Tally>,
  compare: Compare,
): Map<string, PrimaryVerdict> {
  return decidePrimariesWith(
    {
      estimand: plan.estimand,
      alpha: plan.alpha,
      seed: seedOf(plan),
      measures: plan.primary.map((p) => {
        const t = tallies.get(p.measure) as Tally;
        return {
          measure: p.measure,
          margin: p.margin,
          ...(p.safetyMargin === undefined ? {} : { safetyMargin: p.safetyMargin }),
          valueType: t.valueType,
          cases: [...t.cases.values()],
        };
      }),
    },
    compare,
  );
}

function estimateOf(difference: Comparison["difference"]): ComparisonResult["difference"] {
  return {
    estimate: difference.estimate,
    lower: difference.lower,
    upper: difference.upper,
    level: difference.level,
    sided: "lower",
    method: difference.method,
  };
}

/** One result of a comparison, as the decision records it. */
const recorded = (v: Comparison["regression"]): ValidityResult =>
  v.validated
    ? { validated: true, limitations: [] }
    : { validated: false, limitations: [...v.limitations] };

/** Both results of a comparison, as the decision records them. */
function validityOf(c: Comparison): Pick<ComparisonResult, "regression" | "nonInferiority"> {
  return { regression: recorded(c.regression), nonInferiority: recorded(c.nonInferiority) };
}

/** Both results of a comparison that could not be made, for the reason given. */
function noValidity(reason: string): Pick<ComparisonResult, "regression" | "nonInferiority"> {
  const result: ValidityResult = { validated: false, limitations: [reason] };
  return { regression: result, nonInferiority: result };
}

/** A difference of rates without an interval, for a measure that has no comparison. */
function rateDifference(
  t: Tally,
  base: string,
  candidate: string,
  level: number,
): ComparisonResult["difference"] {
  const b = t.arms.get(base);
  const c = t.arms.get(candidate);
  const diff =
    b && c && b.trials > 0 && c.trials > 0
      ? c.successes / c.trials - b.successes / b.trials
      : Number.NaN;
  return {
    estimate: Number.isFinite(diff) ? diff : NAN,
    lower: NEG_INF,
    upper: POS_INF,
    level,
    sided: "lower",
    method: "descriptive (no interval)",
  };
}

/**
 * The comparison of a measure that gives no verdict: a secondary measure, or any measure of an
 * estimate-only decision (REQ-27, REQ-129). It carries the fixed-cases interval with its validated
 * status and limitations, and no test: it is descriptive. When the data supports no interval, the
 * difference has none and the notes say why.
 */
function descriptiveComparison(
  plan: Plan,
  t: Tally,
  pair: { readonly base: string; readonly candidate: string },
  margin: number,
  safetyMargin: number,
  compare: Compare,
): { comparison: ComparisonResult; notes: string[] } {
  const common = {
    base: pair.base,
    candidate: pair.candidate,
    margin,
    safetyMargin,
    nonInferiorityP: NAN,
    regressionP: NAN,
    regressionPAdjusted: NAN,
    regressionMethod: "none (descriptive)",
    flips: flipsOf(t.cases),
  };
  try {
    const valueType = STATS_VALUE_TYPE[t.valueType];
    if (valueType === undefined)
      throw new EstimandError(`a ${t.valueType} measure has no paired method`);
    const c = compare({
      estimand: plan.estimand,
      valueType,
      cases: [...t.cases.values()],
      alpha: plan.alpha,
      margin: Math.max(margin - safetyMargin, 0),
      rng: createRng(seedOf(plan)),
    });
    return {
      comparison: { ...common, difference: estimateOf(c.difference), ...validityOf(c) },
      // regression.validated never vouches for the interval: only nonInferiority does.
      notes: c.nonInferiority.limitations.map((l) => `the interval is not validated: ${l}`),
    };
  } catch (error) {
    if (!(error instanceof EstimandError)) throw error;
    return {
      comparison: {
        ...common,
        difference: rateDifference(t, pair.base, pair.candidate, 1 - plan.alpha),
        ...noValidity(error.message),
      },
      notes: [`no interval: ${error.message}`],
    };
  }
}

function sensitivityResult(
  imputation: SensitivityResult["imputation"],
  v: PrimaryVerdict,
  changesVerdict: boolean,
  level: number,
): SensitivityResult {
  return {
    imputation,
    difference: v.comparison
      ? estimateOf(v.comparison.difference)
      : {
          estimate: NAN,
          lower: NEG_INF,
          upper: POS_INF,
          level,
          sided: "lower",
          method: "none (no comparison)",
        },
    nonInferiorityP: v.comparison?.nonInferiorityP ?? NAN,
    regressionPAdjusted: v.regressionPAdjusted ?? NAN,
    ...(v.comparison ? validityOf(v.comparison) : noValidity(v.notes[0] ?? "no comparison")),
    verdict: v.verdict,
    changesVerdict,
  };
}

/**
 * The scope sentence of a verdict, built from the records (decision 0011). An INVALID decision
 * makes no claim. A failed hard gate says that a deterministic check failed. Otherwise it names the
 * cases the primary measures compare, and says "beyond run-to-run noise" only when every one of
 * them has at least 2 trials in each arm.
 */
function scopeOf(
  verdict: DecisionInput["verdict"],
  gateFailed: boolean,
  plan: Plan,
  tallies: ReadonlyMap<string, Tally>,
): { scope: string; cases: number } {
  const compared = new Set<string>();
  let replicated = true;
  for (const p of plan.primary)
    for (const c of tallies.get(p.measure)?.cases.values() ?? []) {
      if (c.base.trials === 0 || c.candidate.trials === 0) continue;
      compared.add(c.id);
      if (c.base.trials < 2 || c.candidate.trials < 2) replicated = false;
    }
  const cases = compared.size > 0 ? compared.size : new Set(plan.trials.map((t) => t.case)).size;
  if (verdict === "INVALID") return { scope: "no claim: the records fail a check", cases };
  if (gateFailed) return { scope: "a deterministic check failed", cases };
  const fixed = plan.estimand === "fixed-cases";
  if (verdict === null)
    return {
      scope: fixed
        ? `estimates on these ${cases} cases, without a verdict`
        : `estimates on ${cases} randomly drawn cases, without a verdict`,
      cases,
    };
  if (!fixed)
    return { scope: `on the population these ${cases} randomly drawn cases represent`, cases };
  return {
    scope: `on these ${cases} cases${replicated && compared.size > 0 ? ", beyond run-to-run noise" : ""}`,
    cases,
  };
}

/**
 * Applies the decision rule to stored records (DESIGN § 6.3, § 6.4, decision 0011).
 *
 * The run verdict, in this order: INVALID when the records fail a check (the run does not belong to
 * the plan, an identity or template does not match, duplicate, unplanned or self-contradicting
 * records, a gate without a result, the budget, arms that differ beyond what the trigger varies and
 * the plan declares, the base has no value, a primary measure's coverage is below its floor); else
 * REGRESSION when a hard gate failed, in either mode, because a gate does not depend on power; else
 * no verdict when the plan is estimate-only or the run is exploratory; else REGRESSION when a
 * primary measure regressed; else PASS when every primary measure is non-inferior; else
 * INCONCLUSIVE. Whenever a primary measure misses a trial in either arm, each measure's verdict is
 * tested against the imputation that works against it, and a verdict that changes is INCONCLUSIVE
 * (decision 0010).
 */
export function decide(input: DecideInput): Promise<Decision> {
  return decideWith(input, compareCounts);
}

/**
 * `decide` with the comparison given, so a test can decide from results of its own. Not exported
 * by the package: every decision Ichnaea makes uses `compareCounts`.
 */
export async function decideWith(input: DecideInput, compare: Compare): Promise<Decision> {
  const { plan, run } = input;
  const invalid = await recordChecks(input);
  const trials = new Map(input.trials.map((t) => [t.id as string, t]));
  const values = new Map(input.values.map((v) => [`${v.measure}\u0000${v.trial}`, v]));
  const baseArm = plan.arms.find((a) => a.role === "base")?.name;
  const candidateArm = plan.arms.find((a) => a.role === "candidate")?.name;
  const pair =
    baseArm !== undefined && candidateArm !== undefined
      ? { base: baseArm as string, candidate: candidateArm as string }
      : undefined;
  if (plan.mode === "decision" && !pair)
    invalid.push("a decision needs a base and a candidate arm");
  if (plan.mode === "decision" && plan.primary.length === 0)
    invalid.push("a decision needs a primary measure");
  if (pair) invalid.push(...triggerCheck(plan, pair, input.trials));
  // An exploratory run (REQ-16) reports like an estimate-only plan: no confirmatory verdict.
  const modeReasons = run.exploratory
    ? [
        "the run is exploratory: its plan changed after the first trial, so it gives no confirmatory verdict",
        ...plan.modeReasons,
      ]
    : plan.modeReasons;
  const decision = plan.mode === "decision" && !run.exploratory;

  const ids = [
    ...plan.primary.map((p) => p.measure as string),
    ...plan.secondary.map((s) => s as string),
  ];
  const tallies = new Map(ids.map((id) => [id, tally(plan, trials, values, id, pair)]));
  const primaryIds = new Set(plan.primary.map((p) => p.measure as string));
  const compared = pair ? [pair.base, pair.candidate] : plan.arms.map((a) => a.name as string);
  const coverageOf = (t: Tally): number =>
    Math.min(
      ...compared.map((arm) => {
        const av = t.arms.get(arm);
        return av && av.planned > 0 ? av.available / av.planned : 0;
      }),
    );
  for (const p of plan.primary) {
    const t = tallies.get(p.measure) as Tally;
    if (decision && t.unsupported) invalid.push(t.unsupported);
    const coverage = coverageOf(t);
    const floor = p.coverageFloor ?? DEFAULT_COVERAGE_FLOOR;
    if (decision && coverage < floor)
      invalid.push(
        `measure '${p.measure}': coverage ${(coverage * 100).toFixed(1)}% is below its floor of ${(floor * 100).toFixed(1)}%`,
      );
  }

  const tested = decision && pair ? primaryVerdicts(plan, tallies, compare) : undefined;
  // The sensitivity analysis for missing trials (REQ-56, decision 0010): whenever a primary measure
  // misses a trial in either arm, each verdict is tested against the imputation that works
  // against it.
  let sensitivity: "not-needed" | "unchanged" | "changes-verdict" = "not-needed";
  const changed = new Set<string>();
  const imputed = new Map<string, SensitivityResult[]>();
  const missesTrials =
    pair !== undefined &&
    plan.primary.some((p) =>
      [pair.base, pair.candidate].some(
        (arm) => (tallies.get(p.measure)?.arms.get(arm)?.missing ?? 0) > 0,
      ),
    );
  if (tested && pair && missesTrials) {
    const again = (imputation: Imputation): Map<string, PrimaryVerdict> =>
      primaryVerdicts(
        plan,
        new Map(
          plan.primary.map((p) => [
            p.measure as string,
            tally(plan, trials, values, p.measure, pair, imputation),
          ]),
        ),
        compare,
      );
    const againstNonInferiority = again(AGAINST_NON_INFERIORITY);
    const againstRegression = again(AGAINST_REGRESSION);
    for (const [id, v] of tested) {
      const ni = againstNonInferiority.get(id) as PrimaryVerdict;
      const reg = againstRegression.get(id) as PrimaryVerdict;
      const changesNi = v.verdict === "NON-INFERIOR" && ni.verdict !== "NON-INFERIOR";
      const changesReg = v.verdict === "REGRESSION" && reg.verdict !== "REGRESSION";
      if (changesNi || changesReg) changed.add(id);
      imputed.set(id, [
        sensitivityResult("against-non-inferiority", ni, changesNi, 1 - plan.alpha),
        sensitivityResult("against-regression", reg, changesReg, 1 - plan.alpha),
      ]);
    }
    sensitivity = changed.size > 0 ? "changes-verdict" : "unchanged";
  }

  const measures: MeasureResult[] = ids.map((id) => {
    const t = tallies.get(id) as Tally;
    const tier = primaryIds.has(id) ? ("primary" as const) : ("secondary" as const);
    const p = plan.primary.find((x) => x.measure === id);
    const armsOut = plan.arms.map((a) => {
      const av = t.arms.get(a.name) ?? emptyAvailability();
      const rate = wilson({ successes: av.successes, trials: av.trials }, 0.95, "two");
      return {
        arm: a.name,
        rate: {
          estimate: Number.isFinite(rate.estimate) ? rate.estimate : NAN,
          lower: rate.lower,
          upper: rate.upper,
          level: 0.95,
          sided: "two" as const,
          method: "wilson",
        },
        availability: {
          planned: av.planned,
          available: av.available,
          notApplicable: av.notApplicable,
          missing: av.missing,
        },
      };
    });
    const outcome = {
      measure: id,
      version: plan.measures.find((m) => m.id === id)?.version ?? "0.0.0",
      tier,
      estimand: plan.estimand,
      arms: armsOut,
      coverage: coverageOf(t),
      sensitivity: imputed.get(id) ?? [],
    };
    const result = tier === "primary" ? tested?.get(id) : undefined;
    if (!pair)
      return {
        ...outcome,
        comparisons: [],
        verdict: "ESTIMATE-ONLY",
        notes: t.unsupported ? [t.unsupported] : [],
      };
    const margin = p?.margin ?? 0;
    const safetyMargin = p?.safetyMargin ?? 0;
    if (!result) {
      const described = descriptiveComparison(plan, t, pair, margin, safetyMargin, compare);
      return {
        ...outcome,
        comparisons: [described.comparison],
        verdict: "ESTIMATE-ONLY",
        notes: [
          ...(t.unsupported ? [t.unsupported] : []),
          ...(tier === "primary" && !decision ? modeReasons : []),
          ...described.notes,
        ],
      };
    }
    const c = result.comparison;
    const notes = [...result.notes];
    if (c && c.excludedCases > 0)
      notes.push(
        `${c.excludedCases} case(s) have no completed trial in an arm and count as missing`,
      );
    if (changed.has(id))
      notes.push(
        "imputing its missing trials against this verdict changes it, so it is INCONCLUSIVE (see the sensitivity analysis)",
      );
    return {
      ...outcome,
      comparisons: [
        {
          base: pair.base,
          candidate: pair.candidate,
          difference: c
            ? estimateOf(c.difference)
            : rateDifference(t, pair.base, pair.candidate, 1 - plan.alpha),
          margin,
          safetyMargin,
          nonInferiorityP: c ? c.nonInferiorityP : NAN,
          regressionP: c ? c.regressionP : NAN,
          regressionPAdjusted: result.regressionPAdjusted ?? NAN,
          regressionMethod: c ? c.regressionMethod : "none (no comparison)",
          ...(c ? validityOf(c) : noValidity(result.notes[0] ?? "no comparison")),
          flips: flipsOf(t.cases),
        },
      ],
      verdict: changed.has(id) ? "INCONCLUSIVE" : result.verdict,
      notes,
    };
  });

  // Missingness per arm (REQ-56).
  const byArm = plan.arms.map((a) => {
    const planned = plan.trials.filter((t) => t.arm === a.name);
    const missing = planned.filter((t) =>
      MISSING.has(trials.get(t.id)?.outcome ?? "not_run"),
    ).length;
    return { arm: a.name as string, missing, planned: planned.length };
  });
  if (pair) {
    const base = byArm.find((a) => a.arm === pair.base);
    if (base && base.missing === base.planned)
      invalid.push("the base arm has no trial with a value");
  }

  const primaries = measures.filter((m) => m.tier === "primary");
  const gates = input.gates.filter((g) => plan.hardGates.includes(g.gate));
  const failedGate = gates.find((g) => !g.passed);
  let verdict: DecisionInput["verdict"];
  let reason: string;
  if (invalid.length > 0) {
    verdict = "INVALID";
    reason = invalid[0] as string;
  } else if (failedGate) {
    // A hard gate is deterministic and does not depend on power, so it decides in both modes.
    verdict = "REGRESSION";
    reason = `Hard gate ${failedGate.gate} failed.`;
  } else if (!decision) {
    verdict = null;
    reason = `Estimate-only: ${modeReasons.join("; ") || "the plan supports no verdict"}. It reports estimates, intervals, differences and flips without a verdict.`;
  } else if (primaries.some((m) => m.verdict === "REGRESSION")) {
    verdict = "REGRESSION";
    reason = `Measure ${primaries.find((m) => m.verdict === "REGRESSION")?.measure} dropped beyond run-to-run noise and is not shown non-inferior.`;
  } else if (primaries.length > 0 && primaries.every((m) => m.verdict === "NON-INFERIOR")) {
    verdict = "PASS";
    reason = "Every primary measure is non-inferior and every hard gate passed.";
  } else if (primaries.every((m) => onlyTheFloor(tested?.get(m.measure)))) {
    // The floor alone keeps every measure from NON-INFERIOR: say so in plain words.
    verdict = "INCONCLUSIVE";
    reason = FLOOR_NOT_SET_REASON;
  } else {
    verdict = "INCONCLUSIVE";
    const open = primaries.find((m) => m.verdict !== "NON-INFERIOR");
    const result = open ? tested?.get(open.measure) : undefined;
    const cause =
      open && changed.has(open.measure)
        ? "imputing its missing trials against the verdict changes it"
        : result?.cause === "unvalidated"
          ? "its comparison is outside the validated domain"
          : result?.cause === "non-inferiority-unvalidated" && result.comparison
            ? `its non-inferiority result is not validated, because ${nonInferiorityOnly(result.comparison).join("; ")}`
            : result?.cause === "no-comparison"
              ? `it has no comparison (${result.notes[0] ?? "no data"})`
              : "the cases cannot tell yet";
    reason = `Measure ${open?.measure ?? "?"} could not be shown non-inferior: ${cause}. This is not a pass.`;
  }

  const { scope, cases } = scopeOf(
    verdict,
    verdict === "REGRESSION" && !!failedGate,
    plan,
    tallies,
  );
  const limitations = [
    ...(plan.estimand === "fixed-cases" && verdict !== "INVALID"
      ? [`The result is about these ${cases} cases. It makes no claim about new inputs.`]
      : []),
    "An observed model identity cannot detect a silent update behind the same identity.",
    "Hosted models rarely honour seeds; replicates measure run-to-run noise instead.",
    ...invalid.slice(1).map((m) => `Also invalid: ${m}`),
  ];

  return Decision.parse({
    schema: "ichnaea.decision/1",
    mode: decision ? "decision" : "estimate-only",
    verdict,
    reason,
    scope,
    plan: await digest(plan),
    run: run.id,
    runDigest: await digest(run),
    arms: plan.arms.map((a) => ({ name: a.name, role: a.role, identity: a.identity })),
    differingFactors: pair ? differences(plan, pair.base, pair.candidate).map((d) => d.key) : [],
    alpha: plan.alpha,
    measures,
    gates,
    power: {
      planning: plan.power,
      run: runPower(plan, tallies, pair?.base, verdict === "INVALID"),
    },
    missingness: { byArm, differs: new Set(byArm.map((a) => a.missing)).size > 1, sensitivity },
    invalidReasons: invalid,
    limitations,
    seed: plan.seed,
    decidedAt: input.decidedAt,
    ichnaea: input.ichnaea,
    dataClass: "none",
  } satisfies DecisionInput);
}

/**
 * The run-time power statement (REQ-54, decision 0014): per primary measure, the applicable cases,
 * the zero-noise floor, and the minimum detectable effect simulated from the base arm's per-case
 * rates in this run, labelled with that assumption. It describes the run and never changes its
 * verdict or mode. An INVALID run draws no inference and its base arm may be the broken part, so
 * nothing is simulated: each entry says "run invalid". An entry that cannot be computed says why.
 */
function runPower(
  plan: Plan,
  tallies: ReadonlyMap<string, Tally>,
  base: string | undefined,
  invalid: boolean,
): PowerEntry[] {
  const planned = base === undefined ? new Map<string, number>() : plannedTrialsPerCase(plan, base);
  return plan.primary.map((p): PowerEntry => {
    const t = tallies.get(p.measure);
    const cases = t ? [...t.cases.values()].filter((c) => c.base.trials > 0) : [];
    const n = cases.length;
    const counts = cases.map((c) => planned.get(c.id) ?? plan.replicates);
    const r = counts.length > 0 ? Math.min(...counts) : plan.replicates;
    const common = { measure: p.measure, applicableCases: n, replicates: r, margin: p.margin };
    const effective = p.margin - (p.safetyMargin ?? 0);
    if (invalid) return { computed: false, ...common, reason: "run invalid" };
    if (n === 0 || base === undefined)
      return { computed: false, ...common, reason: "no applicable case with a base value" };
    if (plan.estimand === "sampled-cases") {
      const floor = sampledCasesFloor(n, plan.alpha);
      return {
        computed: true,
        ...common,
        mde: floor,
        floor,
        sampledCasesFloor: floor,
        assumption: "no discordant pairs (a lower bound on the MDE)",
        decidable: floor < effective,
      };
    }
    if (r < 2)
      return {
        computed: false,
        ...common,
        reason: "fixed-cases needs at least 2 trials per case and arm",
      };
    const { mde, floor } = fixedCasesMde({
      rates: cases.map((c) => c.base.successes / c.base.trials),
      replicates: counts,
      alpha: plan.alpha,
      simulations: 1000,
      rng: createRng(seedOf(plan)),
    });
    return {
      computed: true,
      ...common,
      mde,
      floor,
      sampledCasesFloor: sampledCasesFloor(n, plan.alpha),
      assumption: `per-case pass rates of the base arm in this run, trials per case ${describeCounts(counts)}, 1,000 simulations`,
      decidable: mde <= effective,
    };
  });
}
