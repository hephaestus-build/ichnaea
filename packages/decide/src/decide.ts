import {
  Decision,
  digest,
  type GateResult,
  type MeasureValue,
  type Plan,
  type Run,
  type Trial,
  verifyArms,
} from "@hephaestus-build/ichnaea-contracts";
import {
  type ArmCounts,
  type CaseCounts,
  compareCounts,
  createRng,
  EstimandError,
  fixedCasesMde,
  holm,
  sampledCasesFloor,
  wilson,
} from "@hephaestus-build/ichnaea-stats";

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

/** Outcomes that leave a planned trial without a value: they are missing, never a failure. */
const MISSING = new Set(["infrastructure_failure", "not_run", "invalid_configuration"]);
const DEFAULT_COVERAGE_FLOOR = 0.9;
const NAN = { nonFinite: "nan" } as const;
const NEG_INF = { nonFinite: "-inf" } as const;
const POS_INF = { nonFinite: "inf" } as const;

type MeasureOutcome = Decision["measures"][number];

interface Tally {
  readonly perCase: Map<string, { base: ArmCounts; candidate: ArmCounts; family: string }>;
  readonly armAvailability: Map<
    string,
    {
      planned: number;
      available: number;
      notApplicable: number;
      missing: number;
      successes: number;
      trials: number;
    }
  >;
  readonly problems: string[];
  readonly unsupported: string | undefined;
}

function emptyCounts(): ArmCounts {
  return { successes: 0, trials: 0, replicates: 0 };
}

function add(counts: ArmCounts, successes: number, trials: number): ArmCounts {
  return {
    successes: counts.successes + successes,
    trials: counts.trials + trials,
    replicates: counts.replicates + 1,
  };
}

function seedOf(plan: Plan): number {
  const value = BigInt(plan.seed.value);
  return Number((value % 4294967295n) + 1n);
}

/**
 * Collects one measure's counts per case and arm. `infraAsFailure` is the sensitivity analysis
 * (REQ-56): infrastructure failures count as failures instead of missing.
 */
function tally(
  plan: Plan,
  trialsById: ReadonlyMap<string, Trial>,
  values: ReadonlyMap<string, MeasureValue>,
  measure: string,
  base: string,
  candidate: string,
  infraAsFailure: boolean,
): Tally {
  const perCase = new Map<string, { base: ArmCounts; candidate: ArmCounts; family: string }>();
  const armAvailability = new Map<
    string,
    {
      planned: number;
      available: number;
      notApplicable: number;
      missing: number;
      successes: number;
      trials: number;
    }
  >();
  const problems: string[] = [];
  let unsupported: string | undefined;
  for (const planned of plan.trials) {
    const availability = armAvailability.get(planned.arm) ?? {
      planned: 0,
      available: 0,
      notApplicable: 0,
      missing: 0,
      successes: 0,
      trials: 0,
    };
    armAvailability.set(planned.arm, availability);
    const trial = trialsById.get(planned.id);
    const value = values.get(`${measure}\u0000${planned.id}`);
    if (value && !value.applicable) {
      availability.notApplicable++;
      continue;
    }
    availability.planned++;
    const outcome = trial?.outcome ?? "not_run";
    let successes: number;
    let items: number;
    if (MISSING.has(outcome) || !value?.value) {
      if (!(infraAsFailure && outcome === "infrastructure_failure")) {
        availability.missing++;
        continue;
      }
      successes = 0;
      items = 1;
    } else if (value.value.type === "binary") {
      successes = value.value.pass ? 1 : 0;
      items = 1;
    } else if (value.value.type === "proportion") {
      if (value.value.successes > value.value.trials) {
        problems.push(
          `measure '${measure}' trial '${planned.id}': ${value.value.successes} successes of ${value.value.trials}`,
        );
        availability.missing++;
        continue;
      }
      successes = value.value.successes;
      items = value.value.trials;
    } else {
      unsupported = `the decision rule does not yet support '${value.value.type}' values`;
      availability.missing++;
      continue;
    }
    availability.available++;
    availability.successes += successes;
    availability.trials += items;
    if (planned.arm !== base && planned.arm !== candidate) continue;
    const entry = perCase.get(planned.case) ?? {
      base: emptyCounts(),
      candidate: emptyCounts(),
      family: planned.case,
    };
    if (planned.arm === base) entry.base = add(entry.base, successes, items);
    else entry.candidate = add(entry.candidate, successes, items);
    perCase.set(planned.case, entry);
  }
  return { perCase, armAvailability, problems, unsupported };
}

function flipsOf(
  perCase: Tally["perCase"],
): Decision["measures"][number]["comparisons"][number]["flips"] {
  const flips: Array<{
    case: string;
    direction: "negative" | "positive";
    base: number;
    candidate: number;
  }> = [];
  for (const [id, c] of perCase) {
    if (c.base.trials === 0 || c.candidate.trials === 0) continue;
    const b = c.base.successes / c.base.trials;
    const k = c.candidate.successes / c.candidate.trials;
    // The majority outcome counts; a tie is neither good nor bad, so it never flips.
    if (b > 0.5 && k < 0.5) flips.push({ case: id, direction: "negative", base: b, candidate: k });
    else if (b < 0.5 && k > 0.5)
      flips.push({ case: id, direction: "positive", base: b, candidate: k });
  }
  flips.sort((x, y) =>
    x.direction === y.direction ? (x.case < y.case ? -1 : 1) : x.direction === "negative" ? -1 : 1,
  );
  return flips as never;
}

function differingFactors(plan: Plan, base: string, candidate: string): string[] {
  const b = plan.arms.find((a) => a.name === base)?.configuration;
  const c = plan.arms.find((a) => a.name === candidate)?.configuration;
  if (!b || !c) return [];
  const flat = (config: typeof b): Map<string, string> => {
    const out = new Map<string, string>();
    for (const m of config.models)
      out.set(`model.${m.role}`, JSON.stringify([m.provider, m.id, m.version, m.route]));
    for (const p of config.parameters)
      out.set(`parameter.${p.name}`, JSON.stringify([p.value, p.status, p.origin]));
    for (const p of config.prompts)
      out.set(`prompt.${p.name}`, JSON.stringify([p.digest, p.status]));
    for (const [name, f] of Object.entries(config.factors))
      out.set(`factor.${name}`, JSON.stringify(f));
    return out;
  };
  const fb = flat(b);
  const fc = flat(c);
  return [...new Set([...fb.keys(), ...fc.keys()])]
    .filter((k) => fb.get(k) !== fc.get(k))
    .toSorted();
}

/**
 * Applies the decision rule to stored records.
 *
 * Per primary measure, with Δ the candidate minus the base and δ − s the margin minus the safety
 * margin: NON-INFERIOR when the one-sided lower bound exceeds −(δ − s) (an unadjusted test per
 * measure: intersection-union); otherwise REGRESSION when the regression test, Holm-adjusted across
 * primary measures, rejects Δ ≥ 0; otherwise INCONCLUSIVE.
 *
 * Run verdict: INVALID when a primary measure's coverage is below its floor, the budget was
 * exceeded, the base is missing, a stored identity does not match its configuration, or the run
 * does not belong to the plan; else REGRESSION when a hard gate failed or a primary measure
 * regressed; else INCONCLUSIVE when a primary measure is inconclusive; else PASS. In estimate-only
 * mode there is no verdict: rates, differences and flips are descriptive.
 */
export async function decide(input: DecideInput): Promise<Decision> {
  const { plan, run } = input;
  const invalid: string[] = [];
  const notes: string[] = [];
  const planDigest = await digest(plan);
  if (run.plan !== planDigest)
    invalid.push(`the run belongs to plan ${run.plan}, not to this plan (${planDigest})`);
  for (const error of await verifyArms(plan.arms))
    invalid.push(`stored identity at ${error.path} does not match its configuration`);
  if (plan.budget.worstCaseCalls > plan.budget.maxCalls)
    invalid.push(
      `the plan needs ${plan.budget.worstCaseCalls} calls, over the budget of ${plan.budget.maxCalls}`,
    );
  if (
    plan.budget.monthlyRemaining !== undefined &&
    plan.budget.worstCaseCalls > plan.budget.monthlyRemaining
  ) {
    invalid.push(
      `the plan needs ${plan.budget.worstCaseCalls} calls, over the ${plan.budget.monthlyRemaining} left this month`,
    );
  }

  const trialsById = new Map(input.trials.map((t) => [t.id as string, t]));
  if (input.trials.some((t) => t.outcome === "budget_exceeded"))
    invalid.push("the run exhausted its budget");
  const values = new Map(input.values.map((v) => [`${v.measure}\u0000${v.trial}`, v]));
  const base = plan.arms.find((a) => a.role === "base")?.name;
  const candidate = plan.arms.find((a) => a.role === "candidate")?.name;
  const comparing = base !== undefined && candidate !== undefined;
  const mode = plan.mode;
  if (mode === "decision" && !comparing)
    invalid.push("a decision needs a base and a candidate arm");
  const alpha = plan.alpha;
  const rng = createRng(seedOf(plan));

  const results: MeasureOutcome[] = [];
  /** The regression p-value and non-inferiority of each tested primary measure, by measure. */
  const tested = new Map<string, { regressionP: number; nonInferior: boolean }>();
  const tallies = new Map<string, Tally>();
  const allMeasures = [
    ...plan.primary.map((p) => ({ id: p.measure as string, tier: "primary" as const, p })),
    ...plan.secondary.map((id) => ({ id: id as string, tier: "secondary" as const, p: undefined })),
  ];
  for (const { id, tier, p } of allMeasures) {
    const t = tally(plan, trialsById, values, id, base ?? "", candidate ?? "", false);
    tallies.set(id, t);
    invalid.push(...t.problems);
    const version = plan.measures.find((m) => m.id === id)?.version ?? "0.0.0";
    const arms = plan.arms.map((a) => {
      const av = t.armAvailability.get(a.name) ?? {
        planned: 0,
        available: 0,
        notApplicable: 0,
        missing: 0,
        successes: 0,
        trials: 0,
      };
      const rate = wilson({ successes: av.successes, trials: av.trials }, 0.95, "two");
      return {
        arm: a.name,
        rate: {
          estimate: Number.isFinite(rate.estimate) ? rate.estimate : NAN,
          lower: rate.lower,
          upper: rate.upper,
          level: 0.95,
          sided: "two",
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
    const coverages = arms.map((a) =>
      a.availability.planned === 0 ? 0 : a.availability.available / a.availability.planned,
    );
    const coverage = coverages.length === 0 ? 0 : Math.min(...coverages);
    const outcome = {
      measure: id,
      version,
      tier,
      estimand: plan.estimand,
      arms,
      coverage,
      notes: [] as string[],
    };
    if (tier === "primary" && coverage < (p?.coverageFloor ?? DEFAULT_COVERAGE_FLOOR)) {
      invalid.push(
        `measure '${id}': coverage ${(coverage * 100).toFixed(1)}% is below its floor of ${((p?.coverageFloor ?? DEFAULT_COVERAGE_FLOOR) * 100).toFixed(1)}%`,
      );
    }
    if (t.unsupported) outcome.notes.push(t.unsupported);
    if (!comparing) {
      results.push({ ...outcome, comparisons: [], verdict: "ESTIMATE-ONLY" } as never);
      continue;
    }
    const cases: CaseCounts[] = [...t.perCase.entries()].map(([caseId, c]) => ({
      id: caseId,
      base: c.base,
      candidate: c.candidate,
    }));
    const margin = p?.margin ?? 0;
    const safety = p?.safetyMargin ?? 0;
    const flips = flipsOf(t.perCase);
    if (mode === "estimate-only" || tier === "secondary" || t.unsupported || cases.length === 0) {
      const b = t.armAvailability.get(base);
      const c = t.armAvailability.get(candidate);
      const diff =
        b && c && b.trials > 0 && c.trials > 0
          ? c.successes / c.trials - b.successes / b.trials
          : Number.NaN;
      results.push({
        ...outcome,
        comparisons: [
          {
            base,
            candidate,
            difference: {
              estimate: Number.isFinite(diff) ? diff : NAN,
              lower: NEG_INF,
              upper: POS_INF,
              level: 1 - alpha,
              sided: "lower",
              method: "descriptive (no interval)",
            },
            margin,
            safetyMargin: safety,
            nonInferiorityP: NAN,
            regressionP: NAN,
            regressionPAdjusted: NAN,
            flips,
          },
        ],
        verdict: "ESTIMATE-ONLY",
      } as never);
      continue;
    }
    try {
      const result = compareCounts({
        estimand: plan.estimand,
        cases,
        alpha,
        margin: margin - safety,
        rng,
      });
      if (!result.validated)
        notes.push(
          `measure '${id}': the method ${result.difference.method} is not yet validated to the simulation bar`,
        );
      if (result.droppedCases > 0)
        outcome.notes.push(
          `${result.droppedCases} case(s) left the paired analysis because one arm has no value`,
        );
      const ni = result.difference.lower > -(margin - safety);
      if (tier === "primary") tested.set(id, { regressionP: result.regressionP, nonInferior: ni });
      results.push({
        ...outcome,
        comparisons: [
          {
            base,
            candidate,
            difference: {
              estimate: result.difference.estimate,
              lower: result.difference.lower,
              upper: result.difference.upper,
              level: result.difference.level,
              sided: "lower",
              method: result.difference.method,
            },
            margin,
            safetyMargin: safety,
            nonInferiorityP: result.nonInferiorityP,
            regressionP: result.regressionP,
            regressionPAdjusted: NAN,
            flips,
          },
        ],
        verdict: ni ? "NON-INFERIOR" : "INCONCLUSIVE",
      } as never);
    } catch (error) {
      if (!(error instanceof EstimandError)) throw error;
      invalid.push(`measure '${id}': ${error.message}`);
      results.push({ ...outcome, comparisons: [], verdict: "INCONCLUSIVE" } as never);
    }
  }

  // Holm across the primary measures' regression tests (REQ-51).
  const primaryWithTests = results.filter((r) => tested.has(r.measure as string));
  const adjusted = holm(
    primaryWithTests.map(
      (r) => (tested.get(r.measure as string) as { regressionP: number }).regressionP,
    ),
  );
  primaryWithTests.forEach((r, i) => {
    const comparison = r.comparisons[0];
    if (!comparison) return;
    const p = adjusted[i] as number;
    (comparison as { regressionPAdjusted: unknown }).regressionPAdjusted = p;
    const nonInferior = tested.get(r.measure as string)?.nonInferior ?? false;
    if (!nonInferior && p <= alpha) (r as { verdict: string }).verdict = "REGRESSION";
    if (nonInferior && p <= alpha) {
      const lower = comparison.difference.lower as number;
      r.notes.push(
        `a drop smaller than the margin is beyond run-to-run noise: compatible with a drop of up to ${(Math.abs(lower) * 100).toFixed(1)} points`,
      );
    }
  });
  const measures = results;

  // Hard gates (REQ-52): deterministic checks only. A gate without a result cannot pass.
  const gates = plan.hardGates.map((id) => input.gates.find((g) => g.gate === id) ?? null);
  plan.hardGates.forEach((id, i) => {
    if (!gates[i]) invalid.push(`hard gate '${id}' has no result`);
  });
  const gateResults = gates.filter((g): g is GateResult => g !== null);

  // Missingness and the sensitivity analysis (REQ-56).
  const byArm = plan.arms.map((a) => {
    const planned = plan.trials.filter((t) => t.arm === a.name);
    const missing = planned.filter((t) =>
      MISSING.has(trialsById.get(t.id)?.outcome ?? "not_run"),
    ).length;
    return { arm: a.name, missing, planned: planned.length };
  });
  const differs = new Set(byArm.map((a) => a.missing)).size > 1;
  const hasInfra = input.trials.some((t) => t.outcome === "infrastructure_failure");
  let sensitivity: "unchanged" | "changes-verdict" | "not-needed" = "not-needed";
  if (hasInfra && comparing && mode === "decision") {
    sensitivity = "unchanged";
    for (const p of plan.primary) {
      const t = tally(plan, trialsById, values, p.measure, base, candidate, true);
      const cases: CaseCounts[] = [...t.perCase.entries()].map(([caseId, c]) => ({
        id: caseId,
        base: c.base,
        candidate: c.candidate,
      }));
      try {
        const r = compareCounts({
          estimand: plan.estimand,
          cases,
          alpha,
          margin: p.margin - (p.safetyMargin ?? 0),
          rng: createRng(seedOf(plan)),
        });
        const ni = r.difference.lower > -(p.margin - (p.safetyMargin ?? 0));
        const before = measures.find((m) => m.measure === p.measure)?.verdict;
        if ((before === "NON-INFERIOR") !== ni) sensitivity = "changes-verdict";
      } catch {
        sensitivity = "changes-verdict";
      }
    }
  }
  if (
    comparing &&
    byArm.find((a) => a.arm === base)?.missing === byArm.find((a) => a.arm === base)?.planned
  )
    invalid.push("the base arm has no trial with a value");

  // Run verdict (DESIGN § 6.4).
  let verdict: Decision["verdict"];
  let reason: string;
  const primaries = measures.filter((m) => m.tier === "primary");
  if (mode === "estimate-only") {
    verdict = invalid.length > 0 ? "INVALID" : null;
    reason =
      invalid.length > 0
        ? `INVALID: ${invalid[0]}`
        : "Estimate-only: the suite cannot support a verdict, so it reports estimates, differences and flips without one.";
  } else if (invalid.length > 0) {
    verdict = "INVALID";
    reason = `INVALID: ${invalid[0]}`;
  } else if (gateResults.some((g) => !g.passed)) {
    verdict = "REGRESSION";
    reason = `Hard gate ${gateResults.find((g) => !g.passed)?.gate} failed.`;
  } else if (primaries.some((m) => m.verdict === "REGRESSION")) {
    verdict = "REGRESSION";
    reason = `Measure ${primaries.find((m) => m.verdict === "REGRESSION")?.measure} dropped beyond run-to-run noise and is not shown non-inferior.`;
  } else if (primaries.some((m) => m.verdict === "INCONCLUSIVE")) {
    verdict = "INCONCLUSIVE";
    reason = `Measure ${primaries.find((m) => m.verdict === "INCONCLUSIVE")?.measure} could not be shown non-inferior: the cases cannot tell yet. This is not a pass.`;
  } else {
    verdict = "PASS";
    reason = "Every primary measure is non-inferior and every hard gate passed.";
  }

  const limitations = [
    ...(plan.estimand === "fixed-cases"
      ? [
          `The result is about these ${new Set(plan.trials.map((t) => t.case)).size} cases, beyond run-to-run noise. It makes no claim about new inputs.`,
        ]
      : []),
    "An observed model identity cannot detect a silent update behind the same identity.",
    "Hosted models rarely honour seeds; replicates measure run-to-run noise instead.",
    ...invalid.slice(1).map((m) => `Also invalid: ${m}`),
    ...notes,
  ];

  return Decision.parse({
    schema: "ichnaea.decision/1",
    mode,
    verdict,
    reason,
    plan: planDigest,
    run: run.id,
    runDigest: await digest(run),
    arms: plan.arms.map((a) => ({ name: a.name, role: a.role, identity: a.identity })),
    differingFactors: comparing ? differingFactors(plan, base, candidate) : [],
    alpha,
    measures,
    gates: gateResults,
    power: plan.power.length > 0 ? plan.power : powerStatement(plan, tallies, base),
    missingness: { byArm, differs, sensitivity },
    invalidReasons: invalid,
    limitations,
    seed: plan.seed,
    decidedAt: input.decidedAt,
    ichnaea: input.ichnaea,
    dataClass: "none",
  });
}

/**
 * The power statement when the plan has none (an import of existing results): per primary measure,
 * the applicable cases, the zero-noise floor, and the minimum detectable effect simulated from the
 * base arm's per-case rates in this run. It is labelled with that assumption.
 */
function powerStatement(
  plan: Plan,
  tallies: ReadonlyMap<string, Tally>,
  base: string | undefined,
): Decision["power"] {
  return plan.primary.map((p) => {
    const t = tallies.get(p.measure);
    const cases = t ? [...t.perCase.values()].filter((c) => c.base.trials > 0) : [];
    const n = cases.length;
    const r = plan.replicates;
    if (n === 0 || base === undefined) {
      return {
        measure: p.measure,
        applicableCases: n,
        replicates: r,
        margin: p.margin,
        mde: NAN,
        floor: NAN,
        assumption: "no applicable case with a base value",
        decidable: false,
      };
    }
    if (plan.estimand === "sampled-cases") {
      const floor = sampledCasesFloor(n, plan.alpha);
      return {
        measure: p.measure,
        applicableCases: n,
        replicates: r,
        margin: p.margin,
        mde: floor,
        floor,
        sampledCasesFloor: floor,
        assumption: "no discordant pairs (a lower bound on the MDE)",
        decidable: floor <= p.margin,
      };
    }
    if (r < 2) {
      return {
        measure: p.measure,
        applicableCases: n,
        replicates: r,
        margin: p.margin,
        mde: NAN,
        floor: NAN,
        sampledCasesFloor: sampledCasesFloor(n, plan.alpha),
        assumption: "fixed-cases needs at least 2 replicates",
        decidable: false,
      };
    }
    const rates = cases.map((c) => c.base.successes / c.base.trials);
    const { mde, floor } = fixedCasesMde({
      rates,
      replicates: r,
      alpha: plan.alpha,
      simulations: 1000,
      rng: createRng(seedOf(plan)),
    });
    return {
      measure: p.measure,
      applicableCases: n,
      replicates: r,
      margin: p.margin,
      mde,
      floor,
      sampledCasesFloor: sampledCasesFloor(n, plan.alpha),
      assumption: "per-case pass rates of the base arm in this run, 1,000 simulations",
      decidable: mde <= p.margin,
    };
  }) as never;
}
