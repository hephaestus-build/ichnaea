// REQ-15, REQ-20, REQ-27, REQ-49, REQ-51, REQ-52, REQ-53, REQ-54, REQ-56, decisions 0008 and 0009:
// every verdict and rule, on complete records.
import {
  type Decision,
  digest,
  type GateResult,
  type MeasureValue,
  type Plan,
} from "../../src/contracts/index.ts";
import { describe, expect, it } from "vitest";

import { decide, exitCode, planningPower } from "../../src/decide/index.ts";
import {
  configuration,
  type Scenario,
  type ScenarioOptions,
  scenario,
} from "./support/scenario.ts";

const run = (s: Scenario): Decision =>
  decide({ ...s, decidedAt: "2026-11-15T12:00:00Z", ichnaea: "0.0.0" });

/** The scenario with a changed plan, and a run that belongs to it. */
async function withPlan(s: Scenario, change: (p: Plan) => Plan): Promise<Scenario> {
  const plan = change(structuredClone(s.plan));
  return { ...s, plan, run: { ...s.run, plan: (await digest(plan)) as Scenario["run"]["plan"] } };
}

const policy = (action: "block" | "report"): Plan["policy"] => ({
  onRegression: action,
  onInconclusive: action,
  onEstimateOnly: action,
});

const stable = { cases: 60, replicates: 3, base: () => 0.97, candidate: () => 0.97 } as const;
// Refusals are about the records, not the cases: a small valid run decides them as well.
const refusal = { cases: 6, replicates: 2, base: () => 0.97, candidate: () => 0.97 } as const;

describe("run verdicts", () => {
  it("REGRESSION: a failed hard gate decides without randomized assignments", async () => {
    const d = await run(
      await scenario({
        ...stable,
        hardGates: ["app/schema"],
        gates: [{ gate: "app/schema", passed: false, failures: 2 } as GateResult],
      }),
    );
    expect(d).toMatchObject({
      verdict: "REGRESSION",
      cause: "gate",
      reasonCode: "HARD_CHECK_FAILED",
    });
    expect(d.reason).toBe("Hard gate 'app/schema' failed.");
  });
});

const invalidOf = async (s: Scenario): Promise<Decision> => {
  const d = await run(s);
  expect(d.verdict).toBe("INVALID");
  expect(exitCode(d, policy("report"))).toBe(1);
  return d;
};

describe("INVALID (REQ-53): every check, and INVALID always blocks", () => {
  it("over the run budget, over the month's calls, or a trial that exhausted the budget", async () => {
    const s = await scenario({
      cases: 10,
      replicates: 2,
      base: () => 0.9,
      candidate: () => 0.9,
      maxCalls: 5,
    });
    expect((await invalidOf(s)).reason).toBe("the plan needs 40 calls, over the budget of 5");
    const ok = await scenario({ cases: 10, replicates: 2, base: () => 0.9, candidate: () => 0.9 });
    const month = await withPlan(ok, (p) => ({
      ...p,
      budget: { ...p.budget, monthlyRemaining: 39 },
    }));
    expect((await invalidOf(month)).reason).toBe(
      "the plan needs 40 calls, over the 39 left this month",
    );
    const trials = ok.trials.map((t, i) =>
      i === 0 ? { ...t, outcome: "budget_exceeded" as const } : t,
    );
    expect((await invalidOf({ ...ok, trials })).invalidReasons).toContain(
      "the run exhausted its budget",
    );
  });

  it("a run of another plan, or an identity that does not match its configuration", async () => {
    const s = await scenario({ ...refusal });
    const foreign = {
      ...s,
      run: { ...s.run, plan: `sha256:${"0".repeat(64)}` as Scenario["run"]["plan"] },
    };
    expect((await invalidOf(foreign)).reason).toMatch(/^the run belongs to plan sha256:0+/);
    const tampered = await withPlan(s, (p) => ({
      ...p,
      arms: p.arms.map((a, i) =>
        i === 1 ? { ...a, configuration: configuration("model-x", "b2") } : a,
      ),
    }));
    expect((await invalidOf(tampered)).reason).toMatch(
      /^stored configuration at \/arms\/1\/identity/,
    );
  });

  it("no base arm with a value", async () => {
    const d = await invalidOf(
      await scenario({
        ...refusal,
        coverageFloor: 0,
        outcome: (t) => (t.arm === "base" ? "not_run" : undefined),
      }),
    );
    expect(d.invalidReasons).toContain("the base arm has no trial with a value");
  });

  it("a decision without a base and candidate, or without a primary measure", async () => {
    const s = await scenario({ ...refusal });
    const lone = await withPlan(s, (p) => ({
      ...p,
      arms: p.arms.map((a) => ({ ...a, role: "reference" as const })),
    }));
    expect((await invalidOf(lone)).invalidReasons).toContain(
      "a decision needs a base and a candidate arm",
    );
    const empty = await withPlan(s, (p) => ({ ...p, primary: [] }));
    expect((await invalidOf(empty)).invalidReasons).toContain("a decision needs a primary measure");
  });

  it("more than one candidate arm (REQ-57 not yet supported)", async () => {
    const s = await scenario({ ...refusal });
    const two = await withPlan(s, (p) => ({
      ...p,
      arms: [
        ...p.arms,
        {
          ...(p.arms[1] as Plan["arms"][number]),
          name: "candidate2" as Plan["arms"][number]["name"],
        },
      ],
    }));
    expect((await invalidOf(two)).invalidReasons.join(" ")).toMatch(/more than one candidate arm/);
  });

  it("duplicate trials, duplicate values, duplicate or inconsistent gate results", async () => {
    const s = await scenario({
      ...refusal,
      hardGates: ["app/schema"],
      gates: [{ gate: "app/schema", passed: true, failures: 0 } as GateResult],
    });
    const trial = s.trials[0] as Scenario["trials"][number];
    expect((await invalidOf({ ...s, trials: [...s.trials, trial] })).invalidReasons).toContain(
      `duplicate trial ID(s): ${trial.id}`,
    );
    const value = s.values[0] as MeasureValue;
    expect(
      (await invalidOf({ ...s, values: [...s.values, value] })).invalidReasons.join(" "),
    ).toMatch(/duplicate measure value/);
    const failed = { gate: "app/schema", passed: false, failures: 1 } as GateResult;
    expect((await invalidOf({ ...s, gates: [...s.gates, failed] })).invalidReasons).toContain(
      "duplicate gate result(s): app/schema",
    );
    const lying = { gate: "app/schema", passed: true, failures: 3 } as GateResult;
    expect((await invalidOf({ ...s, gates: [lying] })).invalidReasons).toContain(
      "gate 'app/schema' says passed true with 3 failure(s)",
    );
    expect((await invalidOf({ ...s, gates: [] })).invalidReasons).toContain(
      "hard gate 'app/schema' has no result",
    );
  });

  it("trials and values the plan does not list", async () => {
    const s = await scenario({ ...refusal });
    const stray = {
      ...(s.trials[0] as Scenario["trials"][number]),
      id: "elsewhere" as Scenario["trials"][number]["id"],
    };
    expect((await invalidOf({ ...s, trials: [...s.trials, stray] })).invalidReasons).toContain(
      "trial 'elsewhere' is not in the plan",
    );
    const v = { ...(s.values[0] as MeasureValue), trial: "elsewhere" as MeasureValue["trial"] };
    expect((await invalidOf({ ...s, values: [...s.values, v] })).invalidReasons).toContain(
      "a value names trial 'elsewhere', which is not in the plan",
    );
  });

  it("a margin the decision cannot use, instead of an error", async () => {
    const s = await scenario({ ...refusal });
    const wide = await withPlan(s, (p) => ({
      ...p,
      primary: p.primary.map((m) => ({ ...m, margin: 0.05, safetyMargin: 0.1 })),
    }));
    expect((await invalidOf(wide)).invalidReasons).toContain(
      "measure 'app/correct': the margin must be below 1 and at least the safety margin",
    );
  });

  it("a value whose type the decision rule cannot use, and a proportion with too many successes", async () => {
    const s = await scenario({ ...refusal });
    const values = s.values.map((v, i) =>
      i === 0 ? ({ ...v, value: { type: "score", value: 0.5 } } as MeasureValue) : v,
    );
    expect(run({ ...s, values })).toMatchObject({
      verdict: null,
      measures: [
        {
          notes: expect.arrayContaining([expect.stringMatching(/score value.*binary values only/)]),
        },
      ],
    });
    const proportion = s.values.map((v, i) =>
      i === 0
        ? ({ ...v, value: { type: "proportion", successes: 4, trials: 3 } } as MeasureValue)
        : v,
    );
    expect((await invalidOf({ ...s, values: proportion })).invalidReasons.join(" ")).toMatch(
      /4 successes of 3 trials/,
    );
  });

  it("a code change whose arms run different models (REQ-15); a declared configuration change may", async () => {
    const code = await scenario({ ...refusal, candidateModel: "model-b" });
    expect((await invalidOf(code)).reason).toBe(
      "a code change may vary only the code part and what the plan declares as varied, but the arms also differ in model.answer. To allow it, use model.answer: --trigger new-model or --vary model.answer",
    );
    const dependency = await scenario({
      ...refusal,
      candidateModel: "model-b",
      trigger: "dependency",
    });
    expect((await invalidOf(dependency)).reason).toMatch(/^a dependency change may vary only/);
    // A valid change must reach a verdict, so this one uses a run that can decide.
    const config = await scenario({
      ...stable,
      candidateModel: "model-b",
      trigger: "configuration",
      varies: ["model.answer", "factor.code.commit"],
    });
    expect(run(config).invalidReasons).toEqual([]);
  });
});

describe("estimate-only (REQ-27, REQ-49, decision 0008)", () => {
  it("one trial in some cases and two in others gives no verdict, only descriptive estimates, and says why", async () => {
    const d = await run(
      await scenario({
        cases: 20,
        replicates: 1,
        base: () => 0.9,
        candidate: () => 0.7,
        slices: (i) => (i < 4 ? { group: "small" } : undefined),
        replicatesFor: [{ slice: "group", value: "small", replicates: 2, reason: "few cases" }],
      }),
    );
    expect(d.mode).toBe("estimate-only");
    expect(d.verdict).toBeNull();
    expect(d.reason).toMatch(/one trial per case and arm is outside the validated domain/);
    expect(d.measures[0]?.verdict).toBe("ESTIMATE-ONLY");
    // The difference carries its interval, without a test: it is descriptive.
    expect(typeof d.measures[0]?.comparisons[0]?.difference.lower).toBe("number");
    expect(d.measures[0]?.comparisons[0]).toMatchObject({
      nonInferiorityP: { nonFinite: "nan" },
      regressionMethod: "none (descriptive)",
    });
    expect(exitCode(d, policy("block"))).toBe(1);
    expect(exitCode(d, { ...policy("block"), onEstimateOnly: "report" })).toBe(0);
  });

  it("fewer than 5 cases is estimate-only", async () => {
    const d = await run(
      await scenario({ cases: 4, replicates: 3, base: () => 0.9, candidate: () => 0.9 }),
    );
    expect(d.mode).toBe("estimate-only");
    expect(d.reason).toMatch(/4 case\(s\); a decision is validated from 5 cases/);
  });

  it("the planning power statement makes a plan estimate-only when the floor reaches the margin", async () => {
    const s = await scenario({
      cases: 17,
      replicates: 2,
      base: () => 1,
      candidate: () => 1,
      margin: 0.09,
    });
    const additions = planningPower(s.plan);
    expect(additions.mode).toBe("estimate-only");
    expect(additions.modeReasons?.[0]).toMatch(
      /zero-noise floor of 9\.6 points is not below the margin of 9\.0 points/,
    );
    expect(additions.power?.[0]).toMatchObject({
      applicableCases: 17,
      replicates: 2,
      decidable: false,
    });
    const wide = await scenario({
      cases: 17,
      replicates: 2,
      base: () => 1,
      candidate: () => 1,
      margin: 0.1,
    });
    expect(planningPower(wide.plan)).toEqual({
      power: [expect.objectContaining({ decidable: true })],
    });
  });

  it("every comparison states its estimand", async () => {
    const d = await run(
      await scenario({ cases: 30, replicates: 2, base: () => 0.9, candidate: () => 0.9 }),
    );
    for (const m of d.measures) expect(m.estimand).toBe("fixed-cases");
  });
});

describe("secondary measures", () => {
  it("secondary measures are descriptive: they never give or change a verdict", async () => {
    const d = run(await scenario({ ...stable, secondary: ["app/extra"] }));
    const secondary = d.measures.find((m) => m.measure === "app/extra");
    expect(secondary).toMatchObject({ tier: "secondary", verdict: "ESTIMATE-ONLY" });
    expect(secondary?.comparisons[0]?.regressionMethod).toBe("none (descriptive)");
    expect(d.verdict).toBeNull();
  });
});

describe("missing data (REQ-20, REQ-30, REQ-56)", () => {
  it("an invalid configuration is missing even when it carries a value", async () => {
    const s = await scenario({ ...stable });
    const trials = s.trials.map((t, i) =>
      i === 1 ? { ...t, outcome: "invalid_configuration" as const } : t,
    );
    const d = await run({ ...s, trials });
    const arm = d.measures[0]?.arms.find((a) => a.arm === s.trials[1]?.arm);
    expect(arm?.availability.missing).toBe(1);
  });

  it("not applicable is kept apart from planned and missing", async () => {
    const s = await scenario({ ...stable });
    const values = s.values.map((v, i) =>
      i < 6 ? ({ ...v, applicable: false, value: undefined } as unknown as MeasureValue) : v,
    );
    const d = await run({ ...s, values });
    const total = d.measures[0]?.arms.reduce((a, x) => a + x.availability.notApplicable, 0);
    expect(total).toBe(6);
    expect(d.measures[0]?.arms.reduce((a, x) => a + x.availability.planned, 0)).toBe(360 - 6);
  });

  it("scores system failures as failures, never as missing", async () => {
    const s = await scenario({
      cases: 30,
      replicates: 2,
      base: () => 1,
      candidate: () => 1,
      outcome: (t) => (t.arm === "candidate" && t.replicate === 0 ? "system_failure" : undefined),
    });
    for (const failed of s.trials.filter((t) => t.outcome === "system_failure")) {
      s.values.push({
        schema: "ichnaea.measureValue/1",
        trial: failed.id,
        measure: "app/correct" as MeasureValue["measure"],
        version: "1.0.0",
        applicable: true,
        value: { type: "binary", pass: false },
        source: "application",
        dataClass: "none",
      } as MeasureValue);
    }
    const d = await run(s);
    expect(d.measures[0]?.arms.find((a) => a.arm === "candidate")).toMatchObject({
      availability: { missing: 0 },
      rate: { estimate: 0.5 },
    });
    expect(d.verdict).toBeNull();
  });

  it("a reference arm that never ran does not make the comparison invalid", async () => {
    const s = await scenario({ ...stable });
    const withRef = await withPlan(s, (p) => ({
      ...p,
      arms: [
        ...p.arms,
        {
          ...(p.arms[0] as Plan["arms"][number]),
          name: "reference" as Plan["arms"][number]["name"],
          role: "reference" as const,
        },
      ],
    }));
    const d = run(withRef);
    expect(d.verdict).toBeNull();
  });
});

describe("flips and power (REQ-52, REQ-54)", () => {
  it("a flip needs the majority outcome to change; a tie never flips", async () => {
    const s = await scenario({ cases: 10, replicates: 2, base: () => 1, candidate: () => 1 });
    // case-000 fails both candidate trials (a flip); case-001 fails one of two (a tie, no flip).
    const lost = new Set([
      "case-000/candidate/r0",
      "case-000/candidate/r1",
      "case-001/candidate/r0",
    ]);
    const values = s.values.map((v) =>
      lost.has(v.trial) ? ({ ...v, value: { type: "binary", pass: false } } as MeasureValue) : v,
    );
    const d = await run({ ...s, values });
    expect(d.measures[0]?.comparisons[0]?.flips).toEqual([
      { case: "case-000", direction: "negative", base: 1, candidate: 0 },
    ]);
  });

  it("states the power of every run: floor, MDE and whether the margin is decidable", async () => {
    const d = await run(
      await scenario({
        cases: 60,
        replicates: 3,
        base: () => 0.9,
        candidate: () => 0.9,
        margin: 0.005,
      }),
    );
    const power = d.power.run[0];
    expect(power).toMatchObject({
      computed: true,
      applicableCases: 60,
      replicates: 3,
      margin: 0.005,
      decidable: false,
    });
    if (!power?.computed) throw new Error("the run-time entry is computed");
    expect(power.floor).toBeCloseTo(0.0181, 3);
    expect(power.mde).toBeGreaterThan(power.floor);
    const wide = await run(
      await scenario({
        cases: 60,
        replicates: 3,
        base: () => 0.9,
        candidate: () => 0.9,
        margin: 0.2,
      }),
    );
    expect(wide.power.run[0]).toMatchObject({ computed: true, decidable: true });
  });
});

describe("determinism", () => {
  it("decides the same records to the same record", async () => {
    const s = await scenario({ cases: 30, replicates: 2, base: () => 0.9, candidate: () => 0.85 });
    expect(JSON.stringify(await run(s))).toBe(JSON.stringify(await run(s)));
  });
});

/** The zero-noise floor of a plan's first planning entry. */
function floorOf(p: ReturnType<typeof planningPower>): number {
  const entry = p.power?.[0];
  if (!entry?.computed) throw new Error("the planning entry is computed");
  return entry.floor;
}

describe("more trials for a slice of cases", () => {
  const smallGroup: ScenarioOptions = {
    cases: 60,
    replicates: 2,
    base: () => 0.97,
    candidate: () => 0.97,
    margin: 0.1,
    slices: (i: number) => (i < 17 ? { group: "small" } : undefined),
    replicatesFor: [{ slice: "group", value: "small", replicates: 3, reason: "17 cases" }],
  };

  it("plans 3 trials for the slice and 2 for the rest, and describes every completed trial", async () => {
    const s = await scenario(smallGroup);
    expect(s.plan.trials).toHaveLength((17 * 3 + 43 * 2) * 2);
    const d = run(s);
    expect(d.verdict).toBeNull();
    expect(d.scope).toBe("estimates on these 60 cases, without a verdict");
    expect(d.measures[0]?.comparisons[0]).toMatchObject({
      regression: { validated: false },
      nonInferiority: { validated: false },
      regressionMethod: "none (descriptive)",
    });
    expect(d.power.run[0]).toMatchObject({
      computed: true,
      applicableCases: 60,
      replicates: 2,
      assumption: expect.stringMatching(/trials per case 2 \(43 cases\), 3 \(17 cases\)/),
    });
  });

  const { replicatesFor: _r, slices: _s, ...uniform } = smallGroup;

  it("the planning floor uses each case's trial count", async () => {
    const s = await scenario(smallGroup);
    const floor = floorOf(planningPower(s.plan));
    const two = floorOf(planningPower((await scenario(uniform)).plan));
    expect(floor).toBeLessThan(two);
  });
});
