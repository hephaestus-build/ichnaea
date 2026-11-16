// Decision 0011: the order of run verdicts, and scope sentences and reasons built from the records.
import { type Decision, type GateResult } from "../../src/contracts/index.ts";
import { describe, expect, it } from "vitest";

import { decide, exitCode, planningPower } from "../../src/decide/index.ts";
import { decideFloorSet, FLOOR_REASON } from "./support/floor-set.ts";
import { type Scenario, scenario } from "./support/scenario.ts";

const run = (s: Scenario): Decision =>
  decide({ ...s, decidedAt: "2026-11-15T12:00:00Z", ichnaea: "0.0.0" });
const failedGate = {
  hardGates: ["app/schema"],
  gates: [{ gate: "app/schema", passed: false, failures: 3 } as GateResult],
};

describe("verdict order: INVALID, a failed hard gate, estimate-only, statistics", () => {
  it("a failed hard gate gives REGRESSION in an estimate-only run, names the gate and blocks", async () => {
    const s = await scenario({
      cases: 12,
      replicates: 1,
      base: () => 1,
      candidate: () => 1,
      marginStatus: "placeholder",
      ...failedGate,
    });
    expect(s.plan.mode).toBe("estimate-only");
    const d = await run(s);
    expect(d.mode).toBe("estimate-only");
    expect(d.verdict).toBe("REGRESSION");
    expect(d.reason).toBe("Hard gate app/schema failed.");
    expect(d.scope).toBe("a deterministic check failed");
    expect(exitCode(d, s.plan.policy)).toBe(1);
  });

  it("INVALID wins over a failed hard gate", async () => {
    const d = await run(
      await scenario({
        cases: 6,
        replicates: 2,
        base: () => 1,
        candidate: () => 1,
        maxCalls: 1,
        ...failedGate,
      }),
    );
    expect(d.verdict).toBe("INVALID");
  });

  it("an exploratory run gives no confirmatory verdict (REQ-16)", async () => {
    const s = await scenario({ cases: 60, replicates: 3, base: () => 0.97, candidate: () => 0.97 });
    const d = await run({ ...s, run: { ...s.run, exploratory: true } });
    expect(d.mode).toBe("estimate-only");
    expect(d.verdict).toBeNull();
    expect(d.reason).toMatch(
      /^Estimate-only: the run is exploratory: its plan changed after the first trial/,
    );
  });
});

describe("scope sentences come from the records", () => {
  it("'beyond run-to-run noise' only with at least 2 trials per case and arm", async () => {
    const pass = await run(
      await scenario({ cases: 60, replicates: 3, base: () => 0.97, candidate: () => 0.97 }),
    );
    expect(pass.scope).toBe("on these 60 cases, beyond run-to-run noise");
    // One case keeps a single candidate trial: the claim drops the noise clause.
    const thin = await run(
      await scenario({
        cases: 60,
        replicates: 3,
        base: () => 0.97,
        candidate: () => 0.97,
        outcome: (t) =>
          t.arm === "candidate" && t.case === "case-001" && t.replicate > 0
            ? "infrastructure_failure"
            : undefined,
      }),
    );
    expect(thin.verdict).not.toBe("INVALID");
    expect(thin.scope).toBe("on these 60 cases");
  });

  it("the REGRESSION reason claims run-to-run noise only where the scope does", async () => {
    const drop = { cases: 60, replicates: 3, base: () => 0.95, candidate: () => 0.8, margin: 0.05 };
    const replicated = await run(await scenario(drop));
    expect(replicated.verdict).toBe("REGRESSION");
    expect(replicated.scope).toBe("on these 60 cases, beyond run-to-run noise");
    expect(replicated.reason).toBe(
      "Measure app/correct dropped beyond run-to-run noise and is not shown non-inferior.",
    );
    // case-003 loses 2 of its 3 candidate trials: neither text may claim run-to-run noise.
    const thin = await run(
      await scenario({
        ...drop,
        outcome: (t) =>
          t.arm === "candidate" && t.case === "case-003" && t.replicate > 0
            ? "infrastructure_failure"
            : undefined,
      }),
    );
    expect(thin.verdict).toBe("REGRESSION");
    expect(thin.scope).toBe("on these 60 cases");
    expect(thin.reason).toBe("Measure app/correct dropped and is not shown non-inferior.");
  });

  it("estimate-only and INVALID decisions make no claim beyond run-to-run noise", async () => {
    const estimate = await run(
      await scenario({
        cases: 12,
        replicates: 1,
        base: () => 1,
        candidate: () => 1,
        marginStatus: "placeholder",
      }),
    );
    expect(estimate.scope).toBe("estimates on these 12 cases, without a verdict");
    const invalid = await run(
      await scenario({ cases: 60, replicates: 3, base: () => 1, candidate: () => 1, maxCalls: 1 }),
    );
    expect(invalid.scope).toBe("no claim: the records fail a check");
    expect(invalid.limitations.join(" ")).not.toMatch(/about these/);
  });

  it("names the cases the measure compares, not every case of the plan", async () => {
    const d = await run(
      await scenario({
        cases: 60,
        replicates: 3,
        base: () => 0.97,
        candidate: () => 0.97,
        margin: 0.15,
        applies: (_m, i) => i < 17,
      }),
    );
    expect(d.scope).toBe("on these 17 cases, beyond run-to-run noise");
    expect(d.limitations[0]).toBe(
      "The result is about these 17 cases. It makes no claim about new inputs.",
    );
  });
});

describe("the INCONCLUSIVE reason names its cause", () => {
  it("a comparison outside the validated domain", async () => {
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
    expect(d.reason).toBe(
      "Measure app/correct could not be shown non-inferior: its comparison is outside the validated domain. This is not a pass.",
    );
  });

  it("a non-inferiority result that is not validated: the margin floor is not set yet", async () => {
    const d = await run(
      await scenario({ cases: 60, replicates: 3, base: () => 0.97, candidate: () => 0.97 }),
    );
    // In plain words, so a first run of an unchanged candidate does not read as a broken setup.
    expect(d.reason).toBe(
      "No primary measure regressed, but no candidate can PASS yet: the validated margin floor for non-inferiority is not set.",
    );
    expect(d.reason).toBe(FLOOR_REASON);
  });

  it("a non-inferiority result that is not validated for more than the floor names each reason", async () => {
    // The planner refuses this margin; the rule still says why if a plan reaches it.
    const d = await run(
      await scenario({
        cases: 60,
        replicates: 3,
        base: () => 0.97,
        candidate: () => 0.97,
        margin: 0.35,
      }),
    );
    expect(d.reason).toBe(
      "Measure app/correct could not be shown non-inferior: its non-inferiority result is not validated, because the validated margin floor is not set yet; margin 0.35 is above the validated margin ceiling 0.3. This is not a pass.",
    );
  });

  it("cases that cannot tell", async () => {
    const d = await decideFloorSet(
      await scenario({
        cases: 10,
        replicates: 2,
        base: () => 0.8,
        candidate: () => 0.8,
        margin: 0.2,
      }),
    );
    expect(d.reason).toBe(
      "Measure app/correct could not be shown non-inferior: the cases cannot tell yet. This is not a pass.",
    );
  });

  it("cases that cannot tell while the floor is not set: the floor is named, not blamed alone", async () => {
    // 12 cases, 2 trials; the base passes every trial and the candidate fails one trial in 2
    // cases. The lower bound is about −25.6 points against a 5-point margin.
    const d = await run(
      await scenario({
        cases: 12,
        replicates: 2,
        base: () => 1,
        candidate: () => 1,
        margin: 0.05,
        value: (t) =>
          t.arm === "candidate" && ["case-000", "case-001"].includes(t.case)
            ? t.replicate !== 0
            : undefined,
      }),
    );
    const c = d.measures[0]?.comparisons[0];
    expect(c?.difference.lower).toBeCloseTo(-0.256, 3);
    expect(c?.regressionPAdjusted as number).toBeGreaterThan(0.05);
    expect(d.verdict).toBe("INCONCLUSIVE");
    expect(d.reason).not.toBe(FLOOR_REASON);
    expect(d.reason).toBe(
      "Measure app/correct could not be shown non-inferior: the cases cannot tell yet, and the validated margin floor is not set. This is not a pass.",
    );
  });

  it("names each cause when the measures have different ones", async () => {
    // app/b applies to 6 cases only, too few to clear the margin; app/a and app/c clear it.
    const d = await run(
      await scenario({
        cases: 60,
        replicates: 3,
        base: () => 1,
        candidate: () => 1,
        measures: ["app/a", "app/b", "app/c"],
        applies: (m, i) => m !== "app/b" || i < 6,
      }),
    );
    expect(d.verdict).toBe("INCONCLUSIVE");
    expect(d.reason).toBe(
      "Not every primary measure was shown non-inferior. Measures app/a and app/c: no PASS yet, because the validated margin floor is not set. Measure app/b: the cases cannot tell yet, and the validated margin floor is not set. This is not a pass.",
    );
  });

  it("names missing trials only for the measure that misses them", async () => {
    // app/a misses no trial; its candidate fails one trial in 5 cases, a REGRESSION on its own.
    // app/b, app/c and app/d have no candidate value in case-000, so their comparisons are outside
    // the validated domain and outside the Holm family. Imputing their missing trials brings them
    // into the family, and app/a no longer regresses.
    const s = await scenario({
      cases: 60,
      replicates: 3,
      base: () => 1,
      candidate: () => 1,
      margin: 0.05,
      measures: ["app/a", "app/b", "app/c", "app/d"],
    });
    const trials = new Map(s.trials.map((t) => [t.id as string, t]));
    const values = s.values.flatMap((v) => {
      const t = trials.get(v.trial);
      if (t?.arm !== "candidate") return [v];
      if (v.measure !== "app/a") return t.case === "case-000" ? [] : [v];
      const index = Number(t.case?.slice(5));
      return index >= 1 && index <= 5 && t.replicate === 0
        ? [{ ...v, value: { type: "binary" as const, pass: false } }]
        : [v];
    });
    const d = await run({ ...s, values });
    expect(d.verdict).toBe("INCONCLUSIVE");
    expect(d.measures.map((m) => m.verdict)).toEqual(Array(4).fill("INCONCLUSIVE"));
    expect(d.reason).toBe(
      "Not every primary measure was shown non-inferior. Measure app/a: imputing the missing trials of other primary measures against the verdict changes it. Measures app/b, app/c and app/d: their comparisons are outside the validated domain. This is not a pass.",
    );
    expect(d.measures[0]?.notes).toContain(
      "imputing the missing trials of other primary measures against this verdict changes it, so it is INCONCLUSIVE (see the sensitivity analysis)",
    );
    expect(d.reason).not.toMatch(/its missing trials/);
  });
});

/** Why the planner refuses a plan whose one primary measure has this registered margin. */
async function refusal(margin: number): Promise<string | undefined> {
  const s = await scenario({ cases: 60, replicates: 3, base: () => 1, candidate: () => 1, margin });
  return planningPower(s.plan).refuse;
}

describe("margins (decision 0012)", () => {
  it("a placeholder margin gives no verdict: estimate-only, margins not registered", async () => {
    const s = await scenario({
      cases: 60,
      replicates: 3,
      base: () => 0.97,
      candidate: () => 0.97,
      marginStatus: "placeholder",
    });
    expect(s.plan.mode).toBe("estimate-only");
    const d = await run(s);
    expect(d.verdict).toBeNull();
    expect(d.reason).toMatch(
      /^Estimate-only: margins not registered: primary measure 'app\/correct' has a placeholder margin/,
    );
  });

  it("a placeholder margin in a plan forced into decision mode makes the run INVALID", async () => {
    const s = await scenario({
      cases: 60,
      replicates: 3,
      base: () => 0.97,
      candidate: () => 0.97,
      marginStatus: "placeholder",
    });
    const { digest } = await import("../../src/contracts/index.ts");
    const plan = { ...s.plan, mode: "decision" as const, modeReasons: [] };
    const d = await run({
      ...s,
      plan,
      run: { ...s.run, plan: (await digest(plan)) as Scenario["run"]["plan"] },
    });
    expect(d.verdict).toBe("INVALID");
    expect(d.reason).toBe(
      "measure 'app/correct': a placeholder margin gives no verdict, but the plan is in decision mode",
    );
  });

  it("the planner refuses a registered margin outside the validated margins, naming the bound", async () => {
    const { VALIDATED_MARGIN_CEILING, VALIDATED_MARGIN_FLOOR } =
      await import("../../src/stats/index.ts");
    for (const margin of [0, VALIDATED_MARGIN_FLOOR / 2, VALIDATED_MARGIN_FLOOR - 1e-9])
      expect(await refusal(margin)).toBe(
        `primary measure 'app/correct': its margin of ${margin} less its safety margin of 0 is below the validated margin floor of ${VALIDATED_MARGIN_FLOOR}, where no non-inferiority result is validated`,
      );
    expect(await refusal(VALIDATED_MARGIN_FLOOR)).toBeUndefined();
    expect(await refusal(VALIDATED_MARGIN_CEILING)).toBeUndefined();
    const above = VALIDATED_MARGIN_CEILING + 1e-9;
    expect(await refusal(above)).toBe(
      `primary measure 'app/correct': its margin of ${above} less its safety margin of 0 is above the validated margin ceiling of ${VALIDATED_MARGIN_CEILING}, where no non-inferiority result is validated`,
    );
  });

  it("the range applies to the effective margin: the declared margin less its safety margin", async () => {
    // Declared 0.10 with a safety margin of 0.06 is tested at 0.04, below the floor.
    const s = await scenario({
      cases: 60,
      replicates: 3,
      base: () => 1,
      candidate: () => 1,
      margin: 0.1,
      safetyMargin: 0.06,
    });
    const { VALIDATED_MARGIN_FLOOR } = await import("../../src/stats/index.ts");
    expect(planningPower(s.plan).refuse).toBe(
      `primary measure 'app/correct': its margin of 0.1 less its safety margin of 0.06 is below the validated margin floor of ${VALIDATED_MARGIN_FLOOR}, where no non-inferiority result is validated`,
    );
  });

  it("a placeholder margin outside the range is refused at plan time too", async () => {
    const { VALIDATED_MARGIN_CEILING } = await import("../../src/stats/index.ts");
    for (const margin of [0, VALIDATED_MARGIN_CEILING + 0.05]) {
      const s = await scenario({
        cases: 60,
        replicates: 3,
        base: () => 1,
        candidate: () => 1,
        margin,
        marginStatus: "placeholder",
      });
      expect(planningPower(s.plan).refuse).toMatch(/is (below|above) the validated margin/);
    }
  });

  it("the range belongs to the fixed-cases interval: sampled-cases margins are not checked by it", async () => {
    const s = await scenario({
      cases: 12,
      replicates: 1,
      base: () => 1,
      candidate: () => 1,
      margin: 0,
      estimand: "sampled-cases",
      selection: "random",
      family: (i) => `f${i}`,
    });
    expect(planningPower(s.plan).refuse).toBeUndefined();
  });
});
