// REQ-15, REQ-20, REQ-27, REQ-49, REQ-51, REQ-52, REQ-53, REQ-54, REQ-56, decisions 0008 and 0009:
// every verdict and rule, on complete records.
import {
  Decision,
  digest,
  type GateResult,
  type MeasureValue,
  type Plan,
} from "../../src/contracts/index.ts";
import { holm, MARGIN_FLOOR_NOT_SET } from "../../src/stats/index.ts";
import { describe, expect, it } from "vitest";

import { decide, exitCode, planningPower } from "../../src/decide/index.ts";
import { decideFloorSet, FLOOR_REASON } from "./support/floor-set.ts";
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
  it("INCONCLUSIVE, never PASS, for identical, stable arms while the margin floor is not set", async () => {
    const d = await run(await scenario({ ...stable, margin: 0.1 }));
    expect(Decision.safeParse(d).success).toBe(true);
    expect(d.verdict).toBe("INCONCLUSIVE");
    expect(d.reason).toBe(FLOOR_REASON);
    expect(d.measures[0]).toMatchObject({
      verdict: "INCONCLUSIVE",
      notes: [`the non-inferiority result is not validated: ${MARGIN_FLOOR_NOT_SET}`],
    });
    expect(d.measures[0]?.comparisons[0]).toMatchObject({
      regression: { validated: true, limitations: [] },
      nonInferiority: { validated: false, limitations: [MARGIN_FLOOR_NOT_SET] },
      regressionMethod: "exact-stratified-conditional",
    });
    expect(exitCode(d, policy("block"))).toBe(1);
    expect(exitCode(d, policy("report"))).toBe(0);
  });

  it("stays INCONCLUSIVE even with a validated within-run bound", async () => {
    const d = await decideFloorSet(await scenario({ ...stable, margin: 0.1 }));
    expect(Decision.safeParse(d).success).toBe(true);
    expect(d.verdict).toBe("INCONCLUSIVE");
    expect(d.reason).toBe(
      "No drop was detected in these runs. A statistical pass needs randomized blocks.",
    );
    expect(d.measures[0]).toMatchObject({ verdict: "NON-INFERIOR", notes: [] });
    expect(d.measures[0]?.comparisons[0]).toMatchObject({
      regression: { validated: true, limitations: [] },
      nonInferiority: { validated: true, limitations: [] },
      regressionMethod: "exact-stratified-conditional",
    });
    expect(exitCode(d, policy("block"))).toBe(1);
  });

  it("reports a large drop on every case within these runs", async () => {
    const d = await run(
      await scenario({
        cases: 60,
        replicates: 3,
        base: () => 0.95,
        candidate: () => 0.6,
        margin: 0.05,
      }),
    );
    expect(d).toMatchObject({ verdict: "INCONCLUSIVE", reasonCode: "DROP_IN_THESE_RUNS_ONLY" });
    expect(d.measures[0]?.verdict).toBe("INCONCLUSIVE");
    expect(d.measures[0]?.comparisons[0]?.flips.some((f) => f.direction === "negative")).toBe(true);
    expect(exitCode(d, policy("block"))).toBe(1);
    expect(exitCode(d, policy("report"))).toBe(0);
  });

  it("INCONCLUSIVE: a margin the cases cannot resolve, and it never maps to a pass", async () => {
    const d = await run(
      await scenario({
        cases: 10,
        replicates: 2,
        base: () => 0.8,
        candidate: () => 0.8,
        margin: 0.2,
      }),
    );
    expect(d.mode).toBe("decision");
    expect(d.verdict).toBe("INCONCLUSIVE");
    expect(exitCode(d, policy("block"))).toBe(1);
  });

  it("REGRESSION: a failed hard gate wins over non-inferior measures", async () => {
    const d = await run(
      await scenario({
        ...stable,
        hardGates: ["app/schema"],
        gates: [{ gate: "app/schema", passed: false, failures: 2 } as GateResult],
      }),
    );
    expect(d.verdict).toBe("REGRESSION");
    expect(d.reason).toBe("Hard gate 'app/schema' failed.");
  });

  it("a within-run drop inside the margin stays visible alongside the non-inferiority result", async () => {
    // 60 cases, 3 trials (the most the validated domain allows): a 6-point drop on every case is
    // detectable within the run and inside a 15-point margin.
    const s = await scenario({
      cases: 60,
      replicates: 3,
      base: () => 1,
      candidate: () => 0.94,
      margin: 0.15,
      seed: 3,
    });
    const d = await decideFloorSet(s);
    const m = d.measures[0];
    expect(m?.verdict).toBe("NON-INFERIOR");
    expect(m?.comparisons[0]?.regressionPAdjusted as number).toBeLessThanOrEqual(0.05);
    expect(m?.notes.join(" ")).toMatch(/A drop was detected in these runs/);
    // The within-run drop is also detected with an unavailable non-inferiority bound.
    const unset = await run(s);
    expect(unset.reasonCode).toBe("DROP_IN_THESE_RUNS_ONLY");
    expect(unset.measures[0]?.notes).toEqual([
      `the non-inferiority result is not validated: ${MARGIN_FLOOR_NOT_SET}`,
      "A drop was detected in these runs.",
    ]);
  });

  it("reports the within-run scope of a drop with missing trials", async () => {
    const d = await decideFloorSet(
      await scenario({
        cases: 60,
        replicates: 3,
        base: () => 1,
        candidate: () => 0.94,
        margin: 0.15,
        seed: 3,
        outcome: (t) =>
          t.arm === "candidate" && t.case === "case-003" && t.replicate > 0
            ? "infrastructure_failure"
            : undefined,
      }),
    );
    const m = d.measures[0];
    expect(m?.comparisons[0]?.regressionPAdjusted as number).toBeLessThanOrEqual(0.05);
    expect(m?.notes.join(" ")).toMatch(/A drop was detected in these runs/);
    expect(m?.notes.join(" ")).not.toMatch(/run-to-run noise/);
  });
});

const invalidOf = async (s: Scenario): Promise<Decision> => {
  const d = await run(s);
  expect(d.verdict).toBe("INVALID");
  expect(exitCode(d, policy("report"))).toBe(1);
  return d;
};

describe("INVALID (REQ-53): every check, and INVALID always blocks", () => {
  it("coverage below the floor", async () => {
    const d = await invalidOf(
      await scenario({
        cases: 20,
        replicates: 2,
        base: () => 0.9,
        candidate: () => 0.9,
        outcome: (t) =>
          t.arm === "candidate" && t.replicate === 1 ? "infrastructure_failure" : undefined,
      }),
    );
    expect(d.reason).toBe("measure 'app/correct': coverage 50.0% is below its floor of 90.0%");
  });

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
    expect((await invalidOf({ ...s, values })).invalidReasons.join(" ")).toMatch(
      /score value.*binary values only/,
    );
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
    expect((await decideFloorSet(config)).verdict).toBe("INCONCLUSIVE");
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

  it("a comparison outside the validated domain at decision time is INCONCLUSIVE with the reason", async () => {
    // 15 of 60 cases lose one of their two candidate trials: 12.5% of cells hold one trial.
    const d = await run(
      await scenario({
        cases: 60,
        replicates: 2,
        base: () => 1,
        candidate: () => 1,
        coverageFloor: 0.8,
        outcome: (t) =>
          t.arm === "candidate" && t.replicate === 1 && Number(t.case.slice(5)) < 15
            ? "infrastructure_failure"
            : undefined,
      }),
    );
    expect(d.measures[0]?.verdict).toBe("INCONCLUSIVE");
    expect(d.measures[0]?.comparisons[0]?.regression.validated).toBe(false);
    expect(d.measures[0]?.comparisons[0]?.nonInferiority.validated).toBe(false);
    expect(d.measures[0]?.notes).toContain(
      "outside the validated domain: fewer than 90% of case-arm cells have 2 or more completed trials",
    );
    expect(d.verdict).toBe("INCONCLUSIVE");
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

describe("margins and multiplicity (REQ-51)", () => {
  it("a safety margin shifts the threshold, and a bound exactly at −margin is not non-inferior", async () => {
    const base = {
      cases: 60,
      replicates: 3,
      base: () => 0.95,
      candidate: () => 0.93,
      margin: 0.08,
    } as const;
    const plain = await decideFloorSet(await scenario(base));
    const lower = plain.measures[0]?.comparisons[0]?.difference.lower as number;
    expect(plain.measures[0]?.verdict).toBe("NON-INFERIOR");
    const strict = await decideFloorSet(
      await scenario({ ...base, safetyMargin: 0.08 + lower + 0.005 }),
    );
    expect(strict.measures[0]?.verdict).not.toBe("NON-INFERIOR");
    const atBound = await decideFloorSet(await scenario({ ...base, margin: -lower }));
    expect(atBound.measures[0]?.comparisons[0]?.difference.lower).toBe(lower);
    expect(atBound.measures[0]?.verdict).not.toBe("NON-INFERIOR");
  });

  it("adjusts the primary measures' regression tests with Holm", async () => {
    const d = await run(
      await scenario({
        cases: 40,
        replicates: 2,
        base: () => 0.9,
        candidate: () => 0.75,
        measures: ["app/a", "app/b", "app/c"],
        margin: 0.05,
      }),
    );
    const raw = d.measures.map((m) => m.comparisons[0]?.regressionP as number);
    expect(d.measures.map((m) => m.comparisons[0]?.regressionPAdjusted)).toEqual(holm(raw));
  });

  it("secondary measures are descriptive: they never give or change a verdict", async () => {
    const d = await decideFloorSet(await scenario({ ...stable, secondary: ["app/extra"] }));
    const secondary = d.measures.find((m) => m.measure === "app/extra");
    expect(secondary).toMatchObject({ tier: "secondary", verdict: "ESTIMATE-ONLY" });
    expect(secondary?.comparisons[0]?.regressionMethod).toBe("none (descriptive)");
    expect(d.verdict).toBe("INCONCLUSIVE");
  });
});

describe("missing data (REQ-20, REQ-30, REQ-56)", () => {
  it("6 of 60 cases losing their failing candidate trials ends INCONCLUSIVE, not PASS", async () => {
    // Base passes everything. In 6 cases the candidate fails 2 of 3 trials, and exactly those
    // trials are lost: the observed candidate trials all pass.
    const s = await scenario({
      cases: 60,
      replicates: 3,
      base: () => 1,
      candidate: () => 1,
      margin: 0.05,
      outcome: (t) =>
        t.arm === "candidate" && Number(t.case.slice(5)) < 6 && t.replicate > 0
          ? "infrastructure_failure"
          : undefined,
    });
    const d = await decideFloorSet(s);
    expect(d.missingness).toMatchObject({ differs: true, sensitivity: "changes-verdict" });
    expect(d.measures[0]?.verdict).toBe("INCONCLUSIVE");
    expect(d.measures[0]?.notes.join(" ")).toMatch(
      /imputing its missing trials against this verdict changes it, so it is INCONCLUSIVE/,
    );
    expect(d.verdict).toBe("INCONCLUSIVE");
    expect((await run(s)).verdict).toBe("INCONCLUSIVE");
  });

  it("a sensitivity analysis that keeps the verdict leaves it standing", async () => {
    const d = await decideFloorSet(
      await scenario({
        ...stable,
        margin: 0.1,
        outcome: (t) =>
          t.arm === "candidate" && t.case === "case-001" && t.replicate === 0
            ? "infrastructure_failure"
            : undefined,
      }),
    );
    expect(d.missingness).toMatchObject({ differs: true, sensitivity: "unchanged" });
    expect(d.missingness.byArm.find((a) => a.arm === "candidate")?.missing).toBe(1);
    expect(d.verdict).toBe("INCONCLUSIVE");
  });

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
    expect(d.measures[0]?.arms.find((a) => a.arm === "candidate")?.availability.missing).toBe(0);
    expect(d.reasonCode).toBe("DROP_IN_THESE_RUNS_ONLY");
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
    const d = await decideFloorSet(withRef);
    expect(d.verdict).toBe("INCONCLUSIVE");
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

  it("plans 3 trials for the slice and 2 for the rest, and decides on every completed trial", async () => {
    const s = await scenario(smallGroup);
    expect(s.plan.trials).toHaveLength((17 * 3 + 43 * 2) * 2);
    const d = await decideFloorSet(s);
    expect(d.verdict).toBe("INCONCLUSIVE");
    expect(d.scope).toBe("on these 60 cases");
    expect(d.measures[0]?.comparisons[0]).toMatchObject({
      regression: { validated: true },
      nonInferiority: { validated: true },
      regressionMethod: "within-case-permutation",
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
