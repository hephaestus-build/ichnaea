import {
  Decision,
  digest,
  type GateResult,
  type MeasureValue,
  type Plan,
  proportionProblem,
  type Run,
  type Trial,
  verifyArms,
} from "@hephaestus-build/ichnaea-contracts";
import { recordProblems } from "@hephaestus-build/ichnaea-core";
import {
  type CaseCounts,
  type Comparison,
  compareCounts,
  createRng,
  EstimandError,
  fixedCasesMde,
  holm,
  sampledCasesFloor,
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
type MeasureVerdict = MeasureResult["verdict"];

/** Outcomes that leave a planned trial without a value: they are missing, never a failure. */
const MISSING = new Set(["infrastructure_failure", "not_run", "invalid_configuration"]);
const DEFAULT_COVERAGE_FLOOR = 0.9;
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
}

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

/**
 * Collects one measure's counts. With `missingAsFailure` (the sensitivity analysis of DC-6), a
 * missing candidate trial counts as a failed trial instead of being left out.
 */
function tally(
  plan: Plan,
  trials: ReadonlyMap<string, Trial>,
  values: ReadonlyMap<string, MeasureValue>,
  measure: string,
  arms: { readonly base: string; readonly candidate: string } | undefined,
  missingAsFailure: boolean,
): Tally {
  const cases = new Map<string, CaseCounts>();
  const availability = new Map<string, Availability>();
  let unsupported: string | undefined;
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
    let pass: boolean;
    if (MISSING.has(outcome) || value?.value === undefined) {
      av.missing++;
      if (!(missingAsFailure && planned.arm === arms?.candidate)) continue;
      pass = false;
    } else if (value.value.type === "binary") {
      pass = value.value.pass;
      av.available++;
    } else {
      unsupported = `measure '${measure}' has a ${value.value.type} value; the decision rule decides binary values only (DN-8)`;
      av.missing++;
      continue;
    }
    av.successes += pass ? 1 : 0;
    av.trials += 1;
    if (!arms || (planned.arm !== arms.base && planned.arm !== arms.candidate)) continue;
    const entry = cases.get(planned.case) ?? {
      id: planned.case,
      ...(planned.family === undefined ? {} : { family: planned.family }),
      base: { successes: 0, trials: 0 },
      candidate: { successes: 0, trials: 0 },
    };
    const side = planned.arm === arms.base ? "base" : "candidate";
    cases.set(planned.case, {
      ...entry,
      [side]: { successes: entry[side].successes + (pass ? 1 : 0), trials: entry[side].trials + 1 },
    });
  }
  return { cases, arms: availability, ...(unsupported === undefined ? {} : { unsupported }) };
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

function differingFactors(plan: Plan, base: string, candidate: string): string[] {
  const flat = (name: string): Map<string, string> => {
    const out = new Map<string, string>();
    const config = plan.arms.find((a) => a.name === name)?.configuration;
    if (!config) return out;
    for (const m of config.models)
      out.set(`model.${m.role}`, JSON.stringify([m.provider, m.id, m.version, m.route]));
    for (const p of config.parameters)
      out.set(`parameter.${p.name}`, JSON.stringify([p.value, p.status, p.origin]));
    for (const p of config.prompts)
      out.set(`prompt.${p.name}`, JSON.stringify([p.digest, p.status]));
    for (const [n, f] of Object.entries(config.factors)) out.set(`factor.${n}`, JSON.stringify(f));
    return out;
  };
  const fb = flat(base);
  const fc = flat(candidate);
  return [...new Set([...fb.keys(), ...fc.keys()])]
    .filter((k) => fb.get(k) !== fc.get(k))
    .toSorted();
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
  for (const p of plan.primary)
    if (!(p.margin < 1 && (p.safetyMargin ?? 0) <= p.margin))
      invalid.push(
        `measure '${p.measure}': the margin must be below 1 and at least the safety margin`,
      );
  return invalid;
}

/**
 * REQ-15, DN-5 ruling 4: arms may differ only in what the trigger varies. A code or dependency
 * change compares the same models on both arms, so differing models confound the change.
 */
function triggerCheck(plan: Plan, base: string, candidate: string): string[] {
  if (plan.trigger !== "code" && plan.trigger !== "dependency") return [];
  const models = (name: string): string =>
    JSON.stringify(
      (plan.arms.find((a) => a.name === name)?.configuration.models ?? [])
        .map((m) => [
          m.role,
          m.provider.value,
          m.id.value,
          m.version?.value ?? null,
          m.route?.value ?? null,
        ])
        .toSorted(),
    );
  return models(base) === models(candidate)
    ? []
    : [
        `a ${plan.trigger} change must compare the same models on both arms, but the arms' models differ`,
      ];
}

/** A tested primary measure. */
interface Tested {
  readonly verdict: MeasureVerdict;
  readonly comparison?: Comparison;
  readonly notes: readonly string[];
}

/**
 * Per-measure verdicts for the primary measures (DESIGN § 6.3): NON-INFERIOR when the one-sided
 * lower bound exceeds −(δ − s), unadjusted (intersection-union); otherwise REGRESSION when the
 * regression test, Holm-adjusted over the tested primary measures, rejects Δ ≥ 0; otherwise
 * INCONCLUSIVE. A comparison outside the validated domain, or one the data cannot support, gives
 * INCONCLUSIVE and its reasons (DN-8).
 */
function primaryVerdicts(
  plan: Plan,
  tallies: ReadonlyMap<string, Tally>,
): { verdicts: Map<string, Tested>; adjusted: Map<string, number> } {
  const verdicts = new Map<string, Tested>();
  const rng = createRng(seedOf(plan));
  for (const p of plan.primary) {
    const t = tallies.get(p.measure) as Tally;
    const effective = p.margin - (p.safetyMargin ?? 0);
    if (!(effective >= 0 && p.margin < 1)) {
      // The run is INVALID for this already (recordChecks); no comparison can use the margin.
      verdicts.set(p.measure, { verdict: "INCONCLUSIVE", notes: ["the margin cannot be used"] });
      continue;
    }
    try {
      const comparison = compareCounts({
        estimand: plan.estimand,
        cases: [...t.cases.values()],
        alpha: plan.alpha,
        margin: effective,
        rng,
      });
      if (!comparison.validated) {
        verdicts.set(p.measure, {
          verdict: "INCONCLUSIVE",
          comparison,
          notes: comparison.limitations.map((l) => `outside the validated domain: ${l}`),
        });
        continue;
      }
      const nonInferior = comparison.difference.lower > -effective;
      verdicts.set(p.measure, {
        verdict: nonInferior ? "NON-INFERIOR" : "INCONCLUSIVE",
        comparison,
        notes: [],
      });
    } catch (error) {
      if (!(error instanceof EstimandError)) throw error;
      verdicts.set(p.measure, { verdict: "INCONCLUSIVE", notes: [error.message] });
    }
  }
  // Holm over the regression tests of the validated comparisons (REQ-51).
  const family = [...verdicts.entries()].filter(([, v]) => v.comparison?.validated === true);
  const pAdjusted = holm(family.map(([, v]) => (v.comparison as Comparison).regressionP));
  const adjusted = new Map<string, number>();
  family.forEach(([id, v], i) => {
    const pa = pAdjusted[i] as number;
    adjusted.set(id, pa);
    if (pa > plan.alpha) return;
    if (v.verdict !== "NON-INFERIOR") verdicts.set(id, { ...v, verdict: "REGRESSION" });
    else
      verdicts.set(id, {
        ...v,
        notes: [
          ...v.notes,
          `a drop smaller than the margin is beyond run-to-run noise: compatible with a drop of up to ${(Math.abs((v.comparison as Comparison).difference.lower) * 100).toFixed(1)} points`,
        ],
      });
  });
  return { verdicts, adjusted };
}

function descriptive(t: Tally, base: string, candidate: string): ComparisonResult["difference"] {
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
    level: 0.95,
    sided: "lower",
    method: "descriptive (no interval)",
  };
}

/**
 * Applies the decision rule to stored records (DESIGN § 6.3, § 6.4).
 *
 * Run verdict: INVALID when the records fail a check (the run does not belong to the plan, an
 * identity or template does not match, duplicate or unplanned records, a gate without a result,
 * the budget, a trigger whose arms differ beyond what it varies, the base has no value, a primary
 * measure's coverage is below its floor); else REGRESSION when a hard gate failed or a primary
 * measure regressed; else INCONCLUSIVE when a primary measure is inconclusive, including a verdict
 * the missing-as-failure sensitivity analysis changes (DC-6); else PASS, which needs every primary
 * measure shown non-inferior. In estimate-only mode there is no verdict.
 */
export async function decide(input: DecideInput): Promise<Decision> {
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
  const decision = plan.mode === "decision";
  if (decision && !pair) invalid.push("a decision needs a base and a candidate arm");
  if (decision && plan.primary.length === 0) invalid.push("a decision needs a primary measure");
  if (pair) invalid.push(...triggerCheck(plan, pair.base, pair.candidate));

  const ids = [
    ...plan.primary.map((p) => p.measure as string),
    ...plan.secondary.map((s) => s as string),
  ];
  const tallies = new Map(ids.map((id) => [id, tally(plan, trials, values, id, pair, false)]));
  const primaryIds = new Set(plan.primary.map((p) => p.measure as string));
  for (const p of plan.primary) {
    const t = tallies.get(p.measure) as Tally;
    if (decision && t.unsupported) invalid.push(t.unsupported);
    const compared = pair ? [pair.base, pair.candidate] : plan.arms.map((a) => a.name);
    const coverage = Math.min(
      ...compared.map((arm) => {
        const av = t.arms.get(arm);
        return av && av.planned > 0 ? av.available / av.planned : 0;
      }),
    );
    const floor = p.coverageFloor ?? DEFAULT_COVERAGE_FLOOR;
    if (decision && coverage < floor)
      invalid.push(
        `measure '${p.measure}': coverage ${(coverage * 100).toFixed(1)}% is below its floor of ${(floor * 100).toFixed(1)}%`,
      );
  }

  const tested = decision && pair ? primaryVerdicts(plan, tallies) : undefined;
  // DC-6: a verdict holds only if it survives counting missing candidate trials as failures,
  // whenever missingness differs between the arms.
  let sensitivity: "not-needed" | "unchanged" | "changes-verdict" = "not-needed";
  const changed = new Set<string>();
  if (tested && pair) {
    const differs = plan.primary.some((p) => {
      const t = tallies.get(p.measure) as Tally;
      return t.arms.get(pair.base)?.missing !== t.arms.get(pair.candidate)?.missing;
    });
    if (differs) {
      const again = primaryVerdicts(
        plan,
        new Map(
          plan.primary.map((p) => [
            p.measure as string,
            tally(plan, trials, values, p.measure, pair, true),
          ]),
        ),
      );
      for (const [id, v] of tested.verdicts)
        if (again.verdicts.get(id)?.verdict !== v.verdict) changed.add(id);
      sensitivity = changed.size > 0 ? "changes-verdict" : "unchanged";
    }
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
    const compared = pair ? [pair.base, pair.candidate] : plan.arms.map((a) => a.name);
    const coverage = Math.min(
      ...compared.map((arm) => {
        const av = t.arms.get(arm);
        return av && av.planned > 0 ? av.available / av.planned : 0;
      }),
    );
    const outcome = {
      measure: id,
      version: plan.measures.find((m) => m.id === id)?.version ?? "0.0.0",
      tier,
      estimand: plan.estimand,
      arms: armsOut,
      coverage,
    };
    const result = tier === "primary" ? tested?.verdicts.get(id) : undefined;
    if (!pair)
      return {
        ...outcome,
        comparisons: [],
        verdict: "ESTIMATE-ONLY",
        notes: t.unsupported ? [t.unsupported] : [],
      };
    const margin = p?.margin ?? 0;
    const safetyMargin = p?.safetyMargin ?? 0;
    const flips = flipsOf(t.cases);
    if (!result) {
      return {
        ...outcome,
        comparisons: [
          {
            base: pair.base,
            candidate: pair.candidate,
            difference: descriptive(t, pair.base, pair.candidate),
            margin,
            safetyMargin,
            nonInferiorityP: NAN,
            regressionP: NAN,
            regressionPAdjusted: NAN,
            regressionMethod: "none (estimate-only)",
            validated: false,
            flips,
          },
        ],
        verdict: "ESTIMATE-ONLY",
        notes: [
          ...(t.unsupported ? [t.unsupported] : []),
          ...(tier === "primary" && !decision ? plan.modeReasons : []),
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
        "counting missing candidate trials as failures changes this verdict, so it is INCONCLUSIVE (DC-6)",
      );
    return {
      ...outcome,
      comparisons: [
        {
          base: pair.base,
          candidate: pair.candidate,
          difference: c
            ? {
                estimate: c.difference.estimate,
                lower: c.difference.lower,
                upper: c.difference.upper,
                level: c.difference.level,
                sided: "lower",
                method: c.difference.method,
              }
            : descriptive(t, pair.base, pair.candidate),
          margin,
          safetyMargin,
          nonInferiorityP: c ? c.nonInferiorityP : NAN,
          regressionP: c ? c.regressionP : NAN,
          regressionPAdjusted: tested?.adjusted.get(id) ?? NAN,
          regressionMethod: c ? c.regressionMethod : "none (no comparison)",
          validated: c?.validated ?? false,
          flips,
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
  let verdict: DecisionInput["verdict"];
  let reason: string;
  if (invalid.length > 0) {
    verdict = "INVALID";
    reason = invalid[0] as string;
  } else if (!decision) {
    verdict = null;
    reason = `Estimate-only: ${plan.modeReasons.join("; ") || "the plan supports no verdict"}. It reports estimates, differences and flips without a verdict.`;
  } else if (gates.some((g) => !g.passed)) {
    verdict = "REGRESSION";
    reason = `Hard gate ${gates.find((g) => !g.passed)?.gate} failed.`;
  } else if (primaries.some((m) => m.verdict === "REGRESSION")) {
    verdict = "REGRESSION";
    reason = `Measure ${primaries.find((m) => m.verdict === "REGRESSION")?.measure} dropped beyond run-to-run noise and is not shown non-inferior.`;
  } else if (primaries.length > 0 && primaries.every((m) => m.verdict === "NON-INFERIOR")) {
    verdict = "PASS";
    reason = "Every primary measure is non-inferior and every hard gate passed.";
  } else {
    verdict = "INCONCLUSIVE";
    reason = `Measure ${primaries.find((m) => m.verdict !== "NON-INFERIOR")?.measure ?? "?"} could not be shown non-inferior: the cases cannot tell yet. This is not a pass.`;
  }

  const caseCount = new Set(plan.trials.map((t) => t.case)).size;
  const scope =
    plan.estimand === "fixed-cases"
      ? `on these ${caseCount} cases, beyond run-to-run noise`
      : `on the population these ${caseCount} randomly drawn cases represent`;
  const limitations = [
    ...(plan.estimand === "fixed-cases"
      ? [`The result is about these ${caseCount} cases. It makes no claim about new inputs.`]
      : []),
    "An observed model identity cannot detect a silent update behind the same identity.",
    "Hosted models rarely honour seeds; replicates measure run-to-run noise instead.",
    ...invalid.slice(1).map((m) => `Also invalid: ${m}`),
  ];

  return Decision.parse({
    schema: "ichnaea.decision/1",
    mode: plan.mode,
    verdict,
    reason,
    scope,
    plan: await digest(plan),
    run: run.id,
    runDigest: await digest(run),
    arms: plan.arms.map((a) => ({ name: a.name, role: a.role, identity: a.identity })),
    differingFactors: pair ? differingFactors(plan, pair.base, pair.candidate) : [],
    alpha: plan.alpha,
    measures,
    gates,
    power: powerStatement(plan, tallies, pair?.base),
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
 * The power statement of every run (REQ-54): per primary measure, the applicable cases, the
 * zero-noise floor, and the minimum detectable effect simulated from the base arm's per-case rates
 * in this run, labelled with that assumption.
 */
function powerStatement(
  plan: Plan,
  tallies: ReadonlyMap<string, Tally>,
  base: string | undefined,
): DecisionInput["power"] {
  const planned = base === undefined ? new Map<string, number>() : plannedTrialsPerCase(plan, base);
  return plan.primary.map((p) => {
    const t = tallies.get(p.measure);
    const cases = t ? [...t.cases.values()].filter((c) => c.base.trials > 0) : [];
    const n = cases.length;
    const counts = cases.map((c) => planned.get(c.id) ?? plan.replicates);
    const r = counts.length > 0 ? Math.min(...counts) : plan.replicates;
    const common = { measure: p.measure, applicableCases: n, replicates: r, margin: p.margin };
    if (n === 0 || base === undefined)
      return {
        ...common,
        mde: NAN,
        floor: NAN,
        assumption: "no applicable case with a base value",
        decidable: false,
      };
    if (plan.estimand === "sampled-cases") {
      const floor = sampledCasesFloor(n, plan.alpha);
      return {
        ...common,
        mde: floor,
        floor,
        sampledCasesFloor: floor,
        assumption: "no discordant pairs (a lower bound on the MDE)",
        decidable: floor <= p.margin,
      };
    }
    if (r < 2)
      return {
        ...common,
        mde: NAN,
        floor: NAN,
        sampledCasesFloor: sampledCasesFloor(n, plan.alpha),
        assumption: "fixed-cases needs at least 2 trials per case and arm",
        decidable: false,
      };
    const { mde, floor } = fixedCasesMde({
      rates: cases.map((c) => c.base.successes / c.base.trials),
      replicates: counts,
      alpha: plan.alpha,
      simulations: 1000,
      rng: createRng(seedOf(plan)),
    });
    return {
      ...common,
      mde,
      floor,
      sampledCasesFloor: sampledCasesFloor(n, plan.alpha),
      assumption: `per-case pass rates of the base arm in this run, trials per case ${describeCounts(counts)}, 1,000 simulations`,
      decidable: mde <= p.margin,
    };
  });
}
