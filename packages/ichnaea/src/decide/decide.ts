import { admitBlocks } from "./blocks.ts";
import { compareBlocks, MAX_TEST_BLOCKS } from "./block-comparison.ts";
import { canonicalize, digest } from "../contracts/canonical.ts";
import { verifyArms } from "../contracts/identity.ts";
import type { MeasuredValue } from "../contracts/primitives.ts";
import { FactorPart } from "../contracts/records/configuration.ts";
import { Decision, type GateResult } from "../contracts/records/decision.ts";
import type { MeasureValue } from "../contracts/records/measure.ts";
import { type Plan, REFUSED_MARGIN } from "../contracts/records/plan.ts";
import type { Run } from "../contracts/records/run.ts";
import type { Trial } from "../contracts/records/trial.ts";
import { proportionProblem } from "../contracts/values.ts";
import { FAILED_TRIAL_OUTCOMES as FAILED } from "../plan/trial-counting.ts";
import { runReduction } from "./trial-reduction.ts";
import { mustNeverCounts } from "./must-never.ts";
import { runResolution } from "../plan/resolution.ts";
import { configurationDifferences, TRIGGER_VARIES } from "../plan/rules.ts";
import { recordProblems } from "../contracts/run-records.ts";
import {
  type CaseCounts,
  type Comparison,
  type ComparisonInput,
  compareCounts,
  EstimandError,
  type ValueType,
} from "../stats/compare.ts";
import { holm } from "../stats/multiplicity.ts";
import { fixedCasesMde, sampledCasesFloor } from "../stats/power.ts";
import { createRng } from "../stats/rng.ts";
import { estimate } from "../stats/estimate.ts";
import type * as z from "zod";

import { describeCounts, plannedTrialsPerCase, planningPower } from "../plan/power.ts";

import { noiseSummary } from "./noise.ts";

/** Everything a decision is computed from. Reports never compute anything new. */
export interface DecideInput {
  /** The plan that the run carries out. */
  readonly plan: Plan;
  /** The run record with its ledger. */
  readonly run: Run;
  /** The run's trial records. */
  readonly trials: readonly Trial[];
  /** The run's measure values. */
  readonly values: readonly MeasureValue[];
  /** The hard gates' results. */
  readonly gates: readonly GateResult[];
  /** The ISO 8601 timestamp recorded as the decision's `decidedAt`. */
  readonly decidedAt: string;
  /** The Ichnaea version, a semantic version, recorded in the decision. */
  readonly ichnaea: string;
}

type DecisionInput = z.input<typeof Decision>;
type MeasureResult = DecisionInput["measures"][number];
type ComparisonResult = MeasureResult["comparisons"][number];
type PowerEntry = DecisionInput["power"]["run"][number];
type ValidityResult = ComparisonResult["regression"];

/**
 * The comparison of one measure's counts. Descriptive reports use `compareCounts`; a test of the library
 * may pass descriptive results of its own (`decideWith`).
 */
export type Compare = (input: ComparisonInput) => Comparison;
type FactorPartName = z.infer<typeof FactorPart>;

/** Outcomes that leave a planned trial without a value: they are missing, never a failure. */
const MISSING = new Set([
  "infrastructure_failure",
  "not_run",
  "invalid_configuration",
  // The run is INVALID; the trial gives no value, and it is never a failure or a pass.
  "protocol_failure",
]);
const DEFAULT_COVERAGE_FLOOR = 0.9;

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

interface ArmCase {
  planned: number;
  trials: number;
  successes: number;
}

/** One measure's binary counts per case for the compared arms, and availability per arm. */
interface Tally {
  readonly cases: Map<string, CaseCounts>;
  readonly scores: ReadonlyMap<string, number>;
  readonly arms: Map<string, Availability>;
  readonly byArmCase: ReadonlyMap<string, ReadonlyMap<string, ArmCase>>;
  readonly byBlock: ReadonlyMap<number, ReadonlyMap<string, ReadonlyMap<string, ArmCase>>>;
  readonly applicabilityContradictions: number;
  readonly valuesOutsideMask: number;
  /** A value whose type the decision rule cannot use, if any. */
  readonly unsupported?: string;
  /** The type of the measure's values in these records; binary when it has none. */
  readonly valueType: MeasuredValue["type"];
}

/**
 * The plan's planning statement (REQ-54, decision 0017). A plan made with the decide plugin carries
 * it. A plan that carries none gets it from `planningPower`, the plugin's own function, because the
 * statement is a function of the plan alone. Its `floor` and `decidable` say whether the planning
 * floor is below the margin. It never changes the mode: only the plugin switches a plan to
 * estimate-only, before any call. When `planningPower` gives no statement, each entry says only
 * what `decide` observes: the margin is refused, with `planningPower`'s refusal text, or no
 * statement can be computed from the plan (for example, it plans no trial in the base arm). A plan
 * with a primary measure never gives an empty statement.
 */
function planningOf(plan: Plan): PowerEntry[] {
  if (plan.power.length > 0) return plan.power;
  const { power, refuse } = planningPower(plan);
  if (power && power.length > 0) return power;
  return plan.primary.map((p) => {
    const common = {
      computed: false as const,
      measure: p.measure,
      applicableCases: new Set(plan.trials.map((t) => t.case)).size,
      replicates: plan.replicates,
      margin: p.margin,
    };
    return refuse === undefined
      ? {
          ...common,
          reason: "the plan carries no planning statement, and none can be computed from it",
        }
      : { ...common, reason: REFUSED_MARGIN, refusal: refuse };
  });
}

const NO_CASES: ReadonlySet<string> = new Set();

export function seedOf(plan: Plan): number {
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
 * configuration, or a trial without a value) is left out of the observed counts.
 */
function tally(
  plan: Plan,
  trials: ReadonlyMap<string, Trial>,
  values: ReadonlyMap<string, MeasureValue>,
  measure: string,
  arms: { readonly base: string; readonly candidate: string } | undefined,
  excluded: ReadonlySet<string> = NO_CASES,
): Tally {
  const cases = new Map<string, CaseCounts>();
  const availability = new Map<string, Availability>();
  const byArmCase = new Map<string, Map<string, ArmCase>>();
  const byBlock = new Map<number, Map<string, Map<string, ArmCase>>>();
  const scores = new Map<string, number>();
  const masks: Readonly<Record<string, readonly string[]>> | undefined =
    plan.analysis?.applicability;
  const locked = masks?.[measure];
  const mask = locked === undefined ? undefined : new Set<string>(locked);
  let applicabilityContradictions = 0;
  let valuesOutsideMask = 0;
  let unsupported: string | undefined;
  let valueType: MeasuredValue["type"] = "binary";
  for (const planned of plan.trials) {
    const av = availability.get(planned.arm) ?? emptyAvailability();
    availability.set(planned.arm, av);
    const value = values.get(`${measure}\u0000${planned.id}`);
    if (mask ? !mask.has(planned.case) : value?.applicable === false) {
      av.notApplicable++;
      if (mask && value?.applicable) valuesOutsideMask++;
      continue;
    }
    av.planned++;
    const armCases = byArmCase.get(planned.arm) ?? new Map<string, ArmCase>();
    byArmCase.set(planned.arm, armCases);
    const armCase = armCases.get(planned.case) ?? { planned: 0, trials: 0, successes: 0 };
    armCases.set(planned.case, armCase);
    armCase.planned++;
    const contradictsPlan = mask !== undefined && value?.applicable === false;
    if (contradictsPlan) applicabilityContradictions++;
    const outcome = trials.get(planned.id)?.outcome ?? "not_run";
    const side =
      planned.arm === arms?.base
        ? "base"
        : planned.arm === arms?.candidate
          ? "candidate"
          : undefined;
    const v = contradictsPlan ? undefined : value?.value;
    if (!MISSING.has(outcome) && v !== undefined && v.type !== "binary") {
      valueType = v.type;
      unsupported = `measure '${measure}' has a ${v.type} value; the decision rule decides binary values only (decision 0008)`;
      av.missing++;
      continue;
    }
    let pass: boolean;
    if (FAILED.has(outcome) && !contradictsPlan && !excluded.has(planned.id)) {
      pass = false;
      av.available++;
    } else if (MISSING.has(outcome) || excluded.has(planned.id) || v === undefined) {
      av.missing++;
      continue;
    } else {
      pass = v.type === "binary" && v.pass;
      av.available++;
    }
    scores.set(planned.id, Number(pass));
    av.successes += pass ? 1 : 0;
    av.trials += 1;
    armCase.trials++;
    if (pass) armCase.successes++;
    if (planned.block !== undefined) {
      const block = byBlock.get(planned.block) ?? new Map<string, Map<string, ArmCase>>();
      byBlock.set(planned.block, block);
      const blockArm = block.get(planned.arm) ?? new Map<string, ArmCase>();
      block.set(planned.arm, blockArm);
      const cell = blockArm.get(planned.case) ?? { planned: 0, trials: 0, successes: 0 };
      blockArm.set(planned.case, cell);
      cell.trials++;
      if (pass) cell.successes++;
    }
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
    byArmCase,
    byBlock,
    scores,
    applicabilityContradictions,
    valuesOutsideMask,
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

function differences(
  plan: Plan,
  base: string,
  candidate: string,
): ReturnType<typeof configurationDifferences> {
  return configurationDifferences(
    plan.arms.find((arm) => arm.name === base)?.configuration,
    plan.arms.find((arm) => arm.name === candidate)?.configuration,
  );
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

/** A trial's calls over every attempt, in calls the provider accepted. */
function callsOf(t: Trial): number {
  return (t.attempts ?? []).reduce((n, a) => n + a.calls, t.usage?.calls ?? 0);
}

/**
 * The trials whose calls Ichnaea's bounds count, and the imported ones, by the plan's arms: an arm
 * with `runs` is Ichnaea's, any other arm's trials are imported. A plan without `callsPerTrial`
 * was written before the plan recorded its bounds, so none of its calls are sorted: it keeps the
 * decision it was given.
 */
function callsByRunner(
  input: DecideInput,
): { readonly bound: number; readonly ran: Trial[]; readonly imported: Trial[] } | undefined {
  const { plan } = input;
  const bound = plan.budget.callsPerTrial;
  if (bound === undefined) return undefined;
  const runs = new Set(plan.arms.filter((a) => a.runs === true).map((a) => a.name as string));
  const armOf = new Map(plan.trials.map((t) => [t.id as string, t.arm as string]));
  const ran: Trial[] = [];
  const imported: Trial[] = [];
  for (const t of input.trials) (runs.has(armOf.get(t.id) ?? t.arm ?? "") ? ran : imported).push(t);
  return { bound, ran, imported };
}

/**
 * The limitation that reports an import's calls: another runner made them, so the bounds do not
 * apply, but the card still says how many there were. It counts the trials of the arms Ichnaea
 * does not run. Only a plan that carries `callsPerTrial` gets it, so a stored decision recomputes
 * unchanged; and only when those trials recorded a call.
 */
function importedCallsLimitation(input: DecideInput): string[] {
  const sorted = callsByRunner(input);
  const calls = (sorted?.imported ?? []).reduce((n, t) => n + callsOf(t), 0);
  return calls > 0
    ? [
        `The imported trials recorded ${calls} calls. Ichnaea's budget applies only to the trials it runs.`,
      ]
    : [];
}

/**
 * The checks of each trial's attempts (invariant 12). They are numbered 1 to k with no gap. For
 * the trials of the arms Ichnaea runs, the calls of every attempt count against the plan's bound
 * per trial and against the run's budget, so a retry cannot hide an overrun. Every count is of the
 * calls the provider accepted: a call it rejected, for example with HTTP 429, is not a call, so
 * throttling alone never makes a run INVALID. A trial without a count of calls counts none.
 *
 * The bounds guard what Ichnaea spends. An imported trial's calls were made by another runner: they
 * stay on the trial records, the limitation reports them, and they never make the run INVALID. A
 * plan without `callsPerTrial` was written before the plan recorded its bounds, and its calls are
 * not checked, so it keeps the decision it was given.
 *
 * A plan with `callsPerTrial` must book exactly its worst case: the trials of the arms with `runs`
 * times the bound. Without that, an arm that lost its `runs` would check no call and say nothing,
 * so the bounds fail closed. For the same reason, a plan that marks an arm as run must state
 * `callsPerTrial`.
 */
function attemptChecks(input: DecideInput): string[] {
  const invalid: string[] = [];
  for (const t of input.trials) {
    const attempts = t.attempts ?? [];
    if (attempts.some((a, i) => a.attempt !== i + 1))
      invalid.push(
        `trial '${t.id}' lists attempts ${attempts.map((a) => a.attempt).join(", ")}; they must be numbered 1 to k with no gap`,
      );
  }
  const sorted = callsByRunner(input);
  if (sorted === undefined) {
    // Only a plan from before the bounds lacks callsPerTrial, and it marks no arm as run.
    const runs = input.plan.arms.filter((a) => a.runs === true).map((a) => a.name);
    if (runs.length > 0)
      invalid.push(
        `the plan marks arm(s) ${runs.join(", ")} as run by Ichnaea but states no bound of calls per trial`,
      );
    return invalid;
  }
  const { bound, ran } = sorted;
  const { worstCaseCalls } = input.plan.budget;
  const runs = new Set(input.plan.arms.filter((a) => a.runs === true).map((a) => a.name));
  const runTrials = input.plan.trials.filter((t) => runs.has(t.arm)).length;
  if (worstCaseCalls !== runTrials * bound)
    invalid.push(
      `the plan books ${worstCaseCalls} calls in the worst case, but its ${runTrials} trial(s) of the arms Ichnaea runs need ${runTrials * bound} at the bound of ${bound} per trial`,
    );
  const over: { readonly trial: string; readonly calls: number }[] = [];
  let total = 0;
  for (const t of ran) {
    const calls = callsOf(t);
    total += calls;
    if (calls > bound) over.push({ trial: t.id, calls });
  }
  const example = over[0];
  if (example)
    invalid.push(
      `${over.length} trial(s) made more calls over their attempts than the bound of ${bound} per trial, for example '${example.trial}' (${example.calls} calls)`,
    );
  const { maxCalls } = input.plan.budget;
  if (total > maxCalls)
    invalid.push(
      `the run made ${total} calls, over the budget of ${maxCalls}, counting every attempt`,
    );
  return invalid;
}

/** Checks of the records themselves. Each problem makes the run INVALID. */
function recordChecks(input: DecideInput): string[] {
  const { plan, run } = input;
  const invalid: string[] = [];
  const planDigest = digest(plan);
  if (run.plan !== planDigest)
    invalid.push(`the run belongs to plan ${run.plan}, not to this plan (${planDigest})`);
  if (plan.analysis) {
    const analysis = plan.analysis;
    const analysisPlan = digest(analysis);
    const registered = canonicalize(analysis.primary.map((entry) => entry.measure));
    if (
      analysis.alpha !== plan.alpha ||
      analysis.estimand !== plan.estimand ||
      analysis.caseSetDigest !== plan.caseSetDigest ||
      analysis.suiteDigest !== plan.suiteDigest ||
      analysis.base.identity !== plan.arms.find((arm) => arm.role === "base")?.identity ||
      registered !== canonicalize(analysis.holm) ||
      registered !== canonicalize(plan.primary.map((entry) => entry.measure))
    )
      invalid.push("the bound plan disagrees with the locked analysis");
    if (run.execution && run.execution.analysisPlan !== analysisPlan)
      invalid.push("the run execution refers to another analysis plan");
    const wrong = input.trials.find(
      (trial) => trial.analysisPlan !== undefined && trial.analysisPlan !== analysisPlan,
    );
    if (wrong) invalid.push(`trial '${wrong.id}' belongs to another analysis plan`);
  }
  for (const error of verifyArms(plan.arms))
    invalid.push(`stored configuration at ${error.path} does not match (${error.computed})`);
  const names = plan.arms.map((a) => a.name);
  if (new Set(names).size !== names.length) invalid.push("the plan has duplicate arm names");
  if (plan.arms.filter((a) => a.role === "base").length > 1)
    invalid.push("the plan has two base arms");
  if (plan.arms.filter((a) => a.role === "candidate").length > 1)
    invalid.push("the plan has more than one candidate arm, which is not supported yet (REQ-57)");
  const plannedById = new Map(plan.trials.map((t) => [t.id as string, t]));
  if (plannedById.size !== plan.trials.length) invalid.push("the plan has duplicate trial IDs");
  invalid.push(...recordProblems(input));
  const protocol = input.trials.filter((t) => t.outcome === "protocol_failure");
  for (const kind of new Set(protocol.map((t) => t.error?.kind ?? "unknown")))
    invalid.push(
      `a worker reported a protocol failure (${kind}): the harness, not the system, failed`,
    );
  const unplannedTrial = input.trials.find((t) => !plannedById.has(t.id));
  if (unplannedTrial) invalid.push(`trial '${unplannedTrial.id}' is not in the plan`);
  // A value counts for the planned trial's case and arm, so a trial must name exactly those.
  const renamed = input.trials.flatMap((t) => {
    const p = plannedById.get(t.id);
    return p && (t.case !== p.case || t.arm !== p.arm || t.replicate !== p.replicate)
      ? [{ t, p }]
      : [];
  });
  const firstRenamed = renamed[0];
  if (firstRenamed) {
    const { t, p } = firstRenamed;
    invalid.push(
      `${renamed.length} trial(s) name another case, arm or replicate than their planned trial, for example trial '${t.id}' names case '${t.case}', arm '${t.arm}', replicate ${t.replicate}, but the plan has case '${p.case}', arm '${p.arm}', replicate ${p.replicate}`,
    );
  }
  const unplannedValue = input.values.find((v) => !plannedById.has(v.trial));
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
  invalid.push(...attemptChecks(input));
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

/** Both results of a comparison that could not be made, for the reason given. */
function noValidity(reason: string): Pick<ComparisonResult, "regression" | "nonInferiority"> {
  const result: ValidityResult = { validated: false, limitations: [reason] };
  return { regression: result, nonInferiority: result };
}

/** A difference of rates without an interval, for a measure that has no comparison. */
function rateDifference(t: Tally, level: number): ComparisonResult["difference"] {
  const byCase = [...t.cases.values()].flatMap((cell) =>
    cell.base.trials && cell.candidate.trials
      ? [cell.candidate.successes / cell.candidate.trials - cell.base.successes / cell.base.trials]
      : [],
  );
  const diff = byCase.reduce((sum, value) => sum + value, 0) / byCase.length;
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
      comparison: {
        ...common,
        difference: estimateOf(c.difference),
        regression: { validated: false, limitations: ["the comparison is descriptive"] },
        nonInferiority: recorded(c.nonInferiority),
      },
      // regression.validated never vouches for the interval: only nonInferiority does.
      notes: c.nonInferiority.limitations.map((l) => `the interval is not validated: ${l}`),
    };
  } catch (error) {
    if (!(error instanceof EstimandError)) throw error;
    return {
      comparison: {
        ...common,
        difference: rateDifference(t, 1 - plan.alpha),
        ...noValidity(error.message),
      },
      notes: [`no interval: ${error.message}`],
    };
  }
}

function scopeOf(
  verdict: DecisionInput["verdict"],
  gateFailed: boolean,
  plan: Plan,
  tallies: ReadonlyMap<string, Tally>,
): { scope: string; cases: number } {
  const compared = new Set<string>();
  for (const p of plan.primary)
    for (const c of tallies.get(p.measure)?.cases.values() ?? [])
      if (c.base.trials > 0 && c.candidate.trials > 0) compared.add(c.id);
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
    scope: `on these ${cases} cases`,
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
 * REGRESSION when a hard gate failed. Statistical decisions require recorded randomized
 * assignments. A Holm-adjusted block rejection gives REGRESSION, while PASS requires both bounds
 * for every primary measure. A within-run rejection alone gives INCONCLUSIVE. Missing scores
 * receive the completion adverse to the claim under test.
 */
export function decide(input: DecideInput): Decision {
  return decideWith(input, compareCounts);
}

/**
 * `decide` with the comparison given, so a test can decide from results of its own. Not exported
 * by the package. The callback affects descriptive intervals only.
 */
export function decideWith(input: DecideInput, compare: Compare): Decision {
  const { plan, run } = input;
  const invalid = recordChecks(input);
  if (run.execution?.failure === "protocol") invalid.push("the worker failed the protocol");
  if (run.execution?.failure === "budget-exceeded")
    invalid.push("the worker exceeded its call bound");
  if (run.execution?.failure === "worker-closed") invalid.push("the worker closed during a block");
  if (run.execution?.failure === "worker-unresponsive")
    invalid.push(
      "the worker did not answer after cancellation and the budget could not cover a replacement block",
    );
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
  const statedModeReasons =
    run.exploratory && plan.analysis === undefined
      ? [
          "the run is exploratory: its plan changed after the first trial, so it gives no confirmatory verdict",
          ...plan.modeReasons,
        ]
      : plan.modeReasons;
  const blockAdmission = pair && plan.analysis ? admitBlocks(plan, run, input.trials) : undefined;
  const admitted = blockAdmission?.status === "admitted" ? blockAdmission : undefined;
  const refused = blockAdmission?.status === "refused" ? blockAdmission : undefined;
  const modeReasons = refused
    ? [`${refused.reason}: ${refused.detail}`, ...statedModeReasons]
    : !plan.analysis && pair
      ? ["the run has no locked randomized assignments", ...statedModeReasons]
      : statedModeReasons;
  const decision = admitted !== undefined;
  const analysis = plan.analysis;
  const familySize = analysis?.holm.length ?? 0;
  const familySupported = plan.alpha === 0.05 && familySize >= 1 && familySize <= 4;
  const blockEligible =
    admitted !== undefined &&
    admitted.observed === admitted.planned &&
    admitted.effective <= MAX_TEST_BLOCKS &&
    familySupported &&
    2 ** -admitted.effective <= plan.alpha / familySize;

  const ids = [
    ...plan.primary.map((p) => p.measure as string),
    ...plan.secondary.map((s) => s as string),
  ];
  const tallies = new Map(
    ids.map((id) => {
      const counted = tally(plan, trials, values, id, pair, admitted?.excluded);
      const dropped: Readonly<Record<string, number>> | undefined = run.valuesOutsideMask;
      return [
        id,
        { ...counted, valuesOutsideMask: counted.valuesOutsideMask + (dropped?.[id] ?? 0) },
      ];
    }),
  );
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
    const registered = analysis?.primary.find((primary) => primary.measure === p.measure);
    const floor =
      (analysis ? registered?.coverageFloor : p.coverageFloor) ?? DEFAULT_COVERAGE_FLOOR;
    if (decision && (!admitted || admitted.observed === admitted.planned) && coverage < floor)
      invalid.push(
        `measure '${p.measure}': coverage ${(coverage * 100).toFixed(1)}% is below its floor of ${(floor * 100).toFixed(1)}%`,
      );
  }

  const blockResults = new Map<string, ReturnType<typeof compareBlocks>>(
    analysis && admitted
      ? analysis.primary.flatMap((p) => {
          const mask = analysis.applicability[p.measure];
          const counted = tallies.get(p.measure);
          if (!mask?.length || !counted || counted.unsupported) return [];
          const margin = p.margin === undefined ? undefined : p.margin - (p.safetyMargin ?? 0);
          return [
            [
              p.measure,
              compareBlocks(admitted.pairs, new Set(mask), counted.scores, {
                alpha: plan.alpha,
                blockEligible,
                replicates: analysis.replicates,
                ...(margin === undefined ? {} : { margin }),
              }),
            ] as const,
          ];
        })
      : [],
  );
  const blockAdjusted = holm((analysis?.holm ?? []).map((id) => blockResults.get(id)?.blockP ?? 1));
  const withinAdjusted = holm(
    (analysis?.holm ?? []).map((id) => blockResults.get(id)?.withinP ?? 1),
  );
  const adjusted = new Map<string, { block: number; within: number }>(
    (analysis?.holm ?? []).map((id, index) => [
      id,
      {
        block: blockAdjusted[index]!,
        within: withinAdjusted[index]!,
      },
    ]),
  );
  const measures: MeasureResult[] = ids.map((id) => {
    const t = tallies.get(id) as Tally;
    const tier = primaryIds.has(id) ? ("primary" as const) : ("secondary" as const);
    const p = plan.primary.find((x) => x.measure === id);
    const armsOut = plan.arms.map((a) => {
      const av = t.arms.get(a.name) ?? emptyAvailability();
      const cases = [...(t.byArmCase.get(a.name) ?? [])].map(([caseId, counts]) => ({
        id: caseId,
        planned: counts.planned,
        values: Array.from({ length: counts.trials }, (_, index) =>
          Number(index < counts.successes),
        ),
      }));
      const summary = cases.length === 0 ? undefined : estimate({ valueType: "binary", cases });
      const interval = summary?.interval;
      const intervalValidity: ValidityResult =
        interval?.coverage === "conservative"
          ? { validated: true, limitations: [] }
          : {
              validated: false,
              limitations: [
                interval
                  ? "coverage has not been validated"
                  : "no interval from the available trials",
              ],
            };
      const mean = summary?.estimate;
      return {
        arm: a.name,
        rate: {
          estimate: mean === undefined || !Number.isFinite(mean) ? NAN : mean,
          lower: interval?.lower ?? NAN,
          upper: interval?.upper ?? NAN,
          level: 0.95,
          sided: "two" as const,
          method: interval?.method ?? "equal case weights",
        },
        intervalValidity,
        caseAvailability: { planned: cases.length, observed: summary?.cases ?? 0 },
        availability: {
          planned: av.planned,
          available: av.available,
          notApplicable: av.notApplicable,
          missing: av.missing,
        },
      };
    });
    const masks: Readonly<Record<string, readonly string[]>> | undefined = analysis?.applicability;
    const mask = masks?.[id] ?? [
      ...new Set([...t.byArmCase.values()].flatMap((cases) => [...cases.keys()])),
    ];
    const blockNotes = analysis
      ? {
          blocks: {
            planned: analysis.blocks,
            observed: t.byBlock.size,
            effective: null,
            reason: "recorded execution contexts are required",
          },
          noise: noiseSummary(
            plan.arms.map((arm) => arm.name),
            t.byArmCase,
            t.byBlock,
            mask,
            pair,
          ),
        }
      : {};
    const outcome = {
      ...blockNotes,
      measure: id,
      version: plan.measures.find((m) => m.id === id)?.version ?? "0.0.0",
      tier,
      estimand: plan.estimand,
      arms: armsOut,
      coverage: coverageOf(t),
      sensitivity: [],
    };
    const maskNotes: string[] = [];
    if (t.applicabilityContradictions > 0)
      maskNotes.push(
        `APPLICABILITY_CONTRADICTS_PLAN: ${t.applicabilityContradictions} planned trial value(s) were marked not applicable and count as missing`,
      );
    if (t.valuesOutsideMask > 0)
      maskNotes.push(
        `ignored ${t.valuesOutsideMask} value(s) outside the planned applicability mask`,
      );
    if (!pair)
      return {
        ...outcome,
        comparisons: [],
        verdict: "ESTIMATE-ONLY",
        notes: [...maskNotes, ...(t.unsupported ? [t.unsupported] : [])],
      };
    const registered = analysis?.primary.find((primary) => primary.measure === id);
    const margin = (analysis ? registered?.margin : p?.margin) ?? 0;
    const safetyMargin = (analysis ? registered?.safetyMargin : p?.safetyMargin) ?? 0;
    const randomized = blockResults.get(id);
    const pAdjusted = adjusted.get(id);
    if (admitted && randomized && pAdjusted) {
      const observed = rateDifference(t, 1 - plan.alpha);
      const withinDrop = familySupported && pAdjusted.within <= plan.alpha;
      return {
        ...outcome,
        blocks: {
          planned: admitted.planned,
          observed: admitted.observed,
          effective: admitted.effective,
        },
        comparisons: [
          {
            base: pair.base,
            candidate: pair.candidate,
            difference: {
              ...observed,
              lower: Math.min(randomized.blockLower, randomized.withinLower),
              upper: 1,
              method: "minimum of block and within-run lower bounds",
            },
            margin,
            safetyMargin,
            nonInferiorityP: NAN,
            regressionP: randomized.blockP,
            regressionPAdjusted: pAdjusted.block,
            regressionMethod: "randomized block sign-flip",
            regression: blockEligible
              ? { validated: true, limitations: [] }
              : {
                  validated: false,
                  limitations: ["effective block horizon cannot resolve the family"],
                },
            nonInferiority:
              randomized.passReason === undefined
                ? { validated: true, limitations: [] }
                : { validated: false, limitations: [randomized.passReason] },
            randomized: {
              withinP: randomized.withinP,
              withinPAdjusted: pAdjusted.within,
              blockLower: randomized.blockLower,
              withinLower: randomized.withinLower,
              pairs: randomized.withinPairs,
              imputedTrials: randomized.missing,
            },
            flips: flipsOf(t.cases),
          },
        ],
        verdict:
          blockEligible && pAdjusted.block <= plan.alpha
            ? "REGRESSION"
            : randomized.pass
              ? "NON-INFERIOR"
              : "INCONCLUSIVE",
        notes: [
          ...maskNotes,
          ...(withinDrop ? ["The paired randomization test found a drop within these runs."] : []),
          ...(blockEligible
            ? [
                `Block lower bound ${(100 * randomized.blockLower).toFixed(1)} points. Within-run Miettinen–Nurminen lower bound ${(100 * randomized.withinLower).toFixed(1)} points.`,
              ]
            : []),
          ...(randomized.missing > 0
            ? [`The analysis filled ${randomized.missing} missing score(s) against each claim.`]
            : []),
          ...(randomized.passReason === undefined ? [] : [randomized.passReason]),
        ],
      };
    }
    const described = descriptiveComparison(plan, t, pair, margin, safetyMargin, compare);
    return {
      ...outcome,
      comparisons: [described.comparison],
      verdict: "ESTIMATE-ONLY",
      notes: [
        ...maskNotes,
        ...(t.unsupported ? [t.unsupported] : []),
        ...(tier === "primary" && !decision ? modeReasons : []),
        ...described.notes,
      ],
    };
  });

  // Missingness per arm (REQ-56).
  const byArm = plan.arms.map((a) => {
    const planned = plan.trials.filter((t) => t.arm === a.name);
    const missing = planned.filter(
      (t) => MISSING.has(trials.get(t.id)?.outcome ?? "not_run") || admitted?.excluded.has(t.id),
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
  let reasonCode: DecisionInput["reasonCode"];
  let cause: DecisionInput["cause"];
  const withinDrops = familySupported
    ? (analysis?.holm ?? []).filter((id) => (adjusted.get(id)?.within ?? 1) <= plan.alpha)
    : [];
  let verdict: DecisionInput["verdict"];
  let reason: string;
  if (invalid.length > 0) {
    verdict = "INVALID";
    reason = invalid[0] as string;
  } else if (failedGate) {
    // A hard gate is deterministic and does not depend on power, so it decides in both modes.
    verdict = "REGRESSION";
    cause = "gate";
    reasonCode = "HARD_CHECK_FAILED";
    reason = `Hard gate '${failedGate.gate}' failed.`;
  } else if (!admitted) {
    verdict = null;
    reasonCode = refused?.reason;
    reason = `Estimate-only: ${modeReasons.join("; ") || "the plan supports no verdict"}. It reports estimates, intervals, differences and flips without a verdict.`;
  } else {
    const regressed = primaries.filter((m) => m.verdict === "REGRESSION").map((m) => m.measure);
    if (regressed.length > 0) {
      verdict = "REGRESSION";
      cause = "statistical";
      reasonCode = "REGRESSION_DETECTED";
      reason = `The randomized block test found a harmful direction for ${regressed.join(", ")}. The configurations were not interchangeable. The size of the decrease remains uncertain.`;
    } else if (admitted.observed < admitted.planned) {
      verdict = "INCONCLUSIVE";
      reasonCode = "TOO_FEW_BLOCKS";
      reason = `Only ${admitted.observed} of ${admitted.planned} planned blocks completed.`;
      if (withinDrops.length > 0)
        reason += ` Measures ${withinDrops.join(", ")} dropped in these runs.`;
    } else if (withinDrops.length > 0) {
      verdict = "INCONCLUSIVE";
      reasonCode = "DROP_IN_THESE_RUNS_ONLY";
      reason = `Measures ${withinDrops.join(", ")} dropped in these runs.`;
    } else if (primaries.length > 0 && primaries.every((m) => m.verdict === "NON-INFERIOR")) {
      verdict = "PASS";
      reasonCode = "PASS";
      reason =
        "Every primary measure cleared its registered margin with both bounds. Every hard gate passed.";
    } else if (!blockEligible && admitted.effective < admitted.observed) {
      verdict = "INCONCLUSIVE";
      reasonCode = "TOO_FEW_BLOCKS";
      reason = `Shared contexts leave ${admitted.effective} effective blocks. The recorded horizon cannot resolve the planned family.`;
    } else if (!familySupported || admitted.effective > MAX_TEST_BLOCKS) {
      verdict = "INCONCLUSIVE";
      reasonCode = "REGRESSION_TEST_UNVALIDATED";
      reason =
        admitted.effective > MAX_TEST_BLOCKS
          ? `The recorded horizon exceeds the limit of ${MAX_TEST_BLOCKS} effective blocks for exact enumeration.`
          : "The randomized decision rule was validated at alpha 0.05 for one to four primary measures.";
    } else {
      verdict = "INCONCLUSIVE";
      if (!blockEligible) {
        reasonCode = "TOO_FEW_BLOCKS";
        reason = "The effective block horizon cannot resolve the planned family.";
      } else if (
        blockResults.size === familySize &&
        [...blockResults.values()].every((result) => result.passReason === undefined)
      ) {
        reasonCode = "MARGIN_NOT_CLEARED";
        reason = "The evidence does not clear every registered margin with both bounds.";
      } else {
        reasonCode = "NON_INFERIORITY_UNVALIDATED";
        reason = "One or more comparisons fall outside the validated domain for both bounds.";
      }
    }
  }

  const { scope, cases } = scopeOf(verdict, cause === "gate", plan, tallies);
  const limitations = [
    ...(plan.estimand === "fixed-cases" && verdict !== "INVALID"
      ? [`The result is about these ${cases} cases. It makes no claim about new inputs.`]
      : []),
    "An observed model identity cannot detect a silent update behind the same identity.",
    "The recorded seed controls Ichnaea's arm order.",
    ...(admitted
      ? [
          "Both sharp-null tests use the independently assigned order of each case pair.",
          "Back-to-back blocks protect against instance, cache and sandbox state. They protect against a provider shock to one arm only when the blocks are spread in time.",
          "PASS is about the measure as scored.",
          "PASS assumes a common shift across blocks and independent binary trials. Shared shocks can make both bounds too optimistic.",
        ]
      : []),
    ...importedCallsLimitation(input),
    ...invalid.slice(1).map((m) => `Also invalid: ${m}`),
  ];

  const resolution = plan.analysis
    ? runResolution(
        plan.analysis,
        (measure) => {
          const caseCounts = tallies.get(measure)?.cases.values() ?? [];
          const rates = new Map<string, number>();
          for (const c of caseCounts)
            if (c.base.trials > 0) rates.set(c.id, c.base.successes / c.base.trials);
          return rates;
        },
        verdict === "INVALID",
      )
    : undefined;

  const trialReduction = runReduction(plan, input.trials, input.values);
  const mustNever = mustNeverCounts(plan, input.trials, input.values);
  return Decision.parse({
    schema: "ichnaea.decision/1",
    mode: decision ? "decision" : "estimate-only",
    verdict,
    reason,
    ...(reasonCode === undefined ? {} : { reasonCode }),
    ...(cause === undefined ? {} : { cause }),
    ...(verdict === "INCONCLUSIVE" && withinDrops.length > 0 ? { withinRunDrop: true } : {}),
    scope,
    plan: digest(plan),
    run: run.id,
    runDigest: digest(run),
    arms: plan.arms.map((a) => ({ name: a.name, role: a.role, identity: a.identity })),
    differingFactors: pair ? differences(plan, pair.base, pair.candidate).map((d) => d.key) : [],
    alpha: plan.alpha,
    measures,
    gates,
    power: {
      planning: planningOf(plan),
      run: runPower(plan, tallies, pair?.base, verdict === "INVALID"),
    },
    ...(resolution === undefined ? {} : { resolution }),
    ...(trialReduction === undefined ? {} : { trialReduction }),
    ...(mustNever === undefined ? {} : { mustNever }),
    ...(run.execution?.registration === undefined
      ? {}
      : { registration: run.execution.registration }),
    ...(run.execution?.history === undefined ? {} : { history: run.execution.history }),
    missingness: {
      byArm,
      differs: new Set(byArm.map((a) => a.missing)).size > 1,
      sensitivity: [...blockResults.values()].some((result) => result.missing > 0)
        ? "adverse-completion"
        : "not-needed",
    },
    invalidReasons: invalid,
    limitations,
    seed: plan.seed,
    decidedAt: input.decidedAt,
    ichnaea: input.ichnaea,
    dataClass: "none",
  } satisfies DecisionInput);
}

/**
 * The run-time power statement (REQ-54, decision 0017): per primary measure, the applicable cases,
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
