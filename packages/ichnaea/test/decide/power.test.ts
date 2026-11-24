// REQ-54, decision 0017: the power statement of a decision.
import { type Decision, notComputedReason } from "../../src/contracts/index.ts";
import { describe, expect, it } from "vitest";

import { decide, planningPower } from "../../src/decide/index.ts";
import { type Scenario, type ScenarioOptions, scenario } from "./support/scenario.ts";

const run = (s: Scenario): Decision =>
  decide({ ...s, decidedAt: "2026-11-15T12:00:00Z", ichnaea: "0.0.0" });
/** The scenario with the planning statement that the decide plugin adds before any call. */
async function planned(o: ScenarioOptions): Promise<Scenario> {
  const s = await scenario(o);
  const { digest } = await import("../../src/contracts/index.ts");
  const plan = { ...s.plan, ...planningPower(s.plan) };
  return { ...s, plan, run: { ...s.run, plan: (await digest(plan)) as Scenario["run"]["plan"] } };
}
const stable: ScenarioOptions = {
  cases: 60,
  replicates: 3,
  base: () => 0.97,
  candidate: () => 0.97,
};

describe("the power statement (REQ-54)", () => {
  it("an INVALID decision keeps the plan's statement and computes no run-time estimate", async () => {
    const s = await planned({ ...stable, maxCalls: 1 });
    expect(s.plan.power).toHaveLength(1);
    const d = await run(s);
    expect(d.verdict).toBe("INVALID");
    expect(d.power.planning).toEqual(s.plan.power);
    expect(d.power.run).toEqual([
      {
        computed: false,
        measure: "app/correct",
        applicableCases: 60,
        replicates: 3,
        margin: 0.1,
        reason: "run invalid",
      },
    ]);
  });

  it("an INVALID run whose base arm is the broken part leaves no noise estimate to reuse", async () => {
    // A run with no base outcomes cannot supply a base rate for resolution.
    const d = await run(
      await scenario({
        ...stable,
        outcome: (t) => (t.arm === "base" ? "infrastructure_failure" : undefined),
      }),
    );
    expect(d.verdict).toBe("INVALID");
    expect(d.reason).toMatch(/base arm has no trial/);
    expect(d.power.run.filter((e) => e.computed)).toEqual([]);
  });

  it("a run-time estimate never changes the verdict or the mode of its own run", async () => {
    // Noisy base cases make the run-time MDE far larger than the margin; the drop still decides.
    const d = await run(
      await scenario({
        cases: 60,
        replicates: 3,
        base: () => 0.5,
        candidate: () => 0.1,
        margin: 0.1,
      }),
    );
    expect(d.power.run[0]).toMatchObject({ computed: true, decidable: false });
    expect(d.mode).toBe("estimate-only");
    expect(d.verdict).toBeNull();
  });

  it("an entry that was not computed says why, never a bare NaN", async () => {
    const one = await run(
      await scenario({ cases: 20, replicates: 1, base: () => 0.9, candidate: () => 0.9 }),
    );
    expect(one.power.run[0]).toMatchObject({
      computed: false,
      reason: "fixed-cases needs at least 2 trials per case and arm",
    });
    const none = await run(
      await scenario({ ...stable, marginStatus: "placeholder", applies: () => false }),
    );
    expect(none.power.run[0]).toMatchObject({
      computed: false,
      reason: "no applicable case with a base value",
    });
    for (const d of [one, none]) expect(JSON.stringify(d.power)).not.toMatch(/nonFinite|null/);
  });

  it("an estimate-only plan with a placeholder margin carries its planning statement", async () => {
    const s = await planned({ ...stable, marginStatus: "placeholder" });
    expect(s.plan.mode).toBe("estimate-only");
    expect(s.plan.modeReasons.join(" ")).toMatch(/placeholder margin/);
    expect(s.plan.power).toEqual([
      expect.objectContaining({
        computed: true,
        measure: "app/correct",
        applicableCases: 60,
        replicates: 3,
        margin: 0.1,
        decidable: true,
        assumption: expect.stringMatching(/^planning: no noise/),
      }),
    ]);
    const d = await run(s);
    expect(d.verdict).toBeNull();
    expect(d.power.planning).toEqual(s.plan.power);
    // Its INVALID decision keeps the planning statement too.
    const invalid = await run(
      await planned({ ...stable, marginStatus: "placeholder", maxCalls: 1 }),
    );
    expect(invalid.verdict).toBe("INVALID");
    expect(invalid.power.planning).toHaveLength(1);
    expect(invalid.power.planning[0]).toMatchObject({ computed: true, measure: "app/correct" });
  });

  it("every plan carries a planning statement: one trial per case, and sampled-cases", async () => {
    const one = await planned({ cases: 20, replicates: 1, base: () => 1, candidate: () => 1 });
    // A binary plan at one trial per case decides; the statement is not computed and says why.
    expect(one.plan.mode).toBe("decision");
    expect(one.plan.power).toEqual([
      {
        computed: false,
        measure: "app/correct",
        applicableCases: 20,
        replicates: 1,
        margin: 0.1,
        reason: "fixed-cases needs at least 2 trials per case and arm",
      },
    ]);
    const sampled = await planned({
      cases: 40,
      replicates: 1,
      base: () => 1,
      candidate: () => 1,
      estimand: "sampled-cases",
      selection: "random",
      family: (i) => `f${i}`,
    });
    expect(sampled.plan.mode).toBe("estimate-only");
    expect(sampled.plan.power).toEqual([
      expect.objectContaining({
        computed: true,
        applicableCases: 40,
        assumption: expect.stringMatching(/^planning: no discordant pairs/),
      }),
    ]);
  });

  it("an estimate-only plan keeps its own reasons when the floor is out of reach too", async () => {
    const o: ScenarioOptions = {
      cases: 6,
      replicates: 2,
      base: () => 1,
      candidate: () => 1,
      margin: 0.05,
      marginStatus: "placeholder",
    };
    const s = await planned(o);
    expect(s.plan.power[0]).toMatchObject({ computed: true, decidable: false });
    expect(s.plan.modeReasons).toEqual((await scenario(o)).plan.modeReasons);
  });

  it("a plan made without the decide plugin gets its planning statement from the plan", async () => {
    const s = await scenario(stable);
    expect(s.plan.power).toEqual([]);
    const d = await run(s);
    expect(d.power.planning).toEqual(planningPower(s.plan).power);
    expect(d.power.planning).toEqual([
      expect.objectContaining({
        computed: true,
        measure: "app/correct",
        applicableCases: 60,
        replicates: 3,
        decidable: true,
        assumption: expect.stringMatching(/^planning: no noise/),
      }),
    ]);
    // The planning floor is computed too. It never changes the mode after the calls.
    const narrow = await scenario({
      cases: 12,
      replicates: 2,
      base: () => 1,
      candidate: () => 1,
      margin: 0.05,
    });
    const floored = await run(narrow);
    expect(floored.power.planning).toEqual([
      expect.objectContaining({ computed: true, decidable: false }),
    ]);
    expect(planningPower(narrow.plan).mode).toBe("estimate-only");
    expect(floored.mode).toBe("estimate-only");
  });

  it("a plan without a statement whose margin is refused carries the refusal", async () => {
    // The plugin refuses a margin above the validated ceiling, so it states no power for it.
    const s = await scenario({ ...stable, margin: 0.35 });
    const { power, refuse } = planningPower(s.plan);
    expect(power).toBeUndefined();
    expect(refuse).toBe(
      "primary measure 'app/correct': its margin of 0.35 less its safety margin of 0 is above the validated margin ceiling of 0.3, where no non-inferiority result is validated",
    );
    const d = await run(s);
    expect(d.power.planning).toEqual([
      {
        computed: false,
        measure: "app/correct",
        applicableCases: 60,
        replicates: 3,
        margin: 0.35,
        reason: "the plan carries no planning statement, and its margin is refused",
        refusal: refuse,
      },
    ]);
    expect(d.power.planning.map((p) => !p.computed && notComputedReason(p))).toEqual([
      "the plan carries no planning statement, and its margin is refused: primary measure 'app/correct': its margin of 0.35 less its safety margin of 0 is above the validated margin ceiling of 0.3, where no non-inferiority result is validated",
    ]);
  });

  it("a plan without a statement that plans no base-arm trial says none can be computed", async () => {
    const s = await scenario(stable);
    const plan = { ...s.plan, trials: s.plan.trials.filter((t) => t.arm !== "base") };
    expect(planningPower(plan)).toEqual({});
    const d = await run({ ...s, plan });
    expect(d.power.planning).toEqual([
      {
        computed: false,
        measure: "app/correct",
        applicableCases: 60,
        replicates: 3,
        margin: 0.1,
        reason: "the plan carries no planning statement, and none can be computed from it",
      },
    ]);
  });

  // One test per fixture: each runs a decision with and without the plugin, and nine of them in one
  // test would add up past the default timeout on a loaded runner.
  it.each<[string, ScenarioOptions]>([
    ["stable", stable],
    ["stable at one call", { ...stable, maxCalls: 1 }],
    ["a placeholder margin", { ...stable, marginStatus: "placeholder" }],
    ["a margin of 0.35", { ...stable, margin: 0.35 }],
    ["two primary measures", { ...stable, measures: ["app/correct", "app/grounded"] }],
    [
      "a placeholder margin that does not apply",
      { ...stable, marginStatus: "placeholder", applies: () => false },
    ],
    ["20 cases at one trial", { cases: 20, replicates: 1, base: () => 0.9, candidate: () => 0.9 }],
    [
      "6 cases at rate 1",
      { cases: 6, replicates: 2, base: () => 1, candidate: () => 1, margin: 0.05 },
    ],
    [
      "40 sampled cases",
      {
        cases: 40,
        replicates: 1,
        base: () => 1,
        candidate: () => 1,
        estimand: "sampled-cases",
        selection: "random",
        family: (i) => `f${i}`,
      },
    ],
  ])(
    "no decision carries an empty planning statement, with or without the plugin: %s",
    async (_, o) => {
      const bare = await scenario(o);
      // The plugin refuses a margin outside the validated margins: that plan exists only without it.
      const made = planningPower(bare.plan).refuse ? [bare] : [bare, await planned(o)];
      for (const s of made) {
        const d = await run(s);
        expect(d.power.planning).toHaveLength(s.plan.primary.length);
        expect(d.power.planning.length).toBeGreaterThan(0);
        expect(JSON.stringify(d.power.planning)).not.toMatch(/nonFinite|null/);
      }
    },
  );

  it("estimate-only and INCONCLUSIVE decisions keep the run-time estimate", async () => {
    const estimate = await run(
      await scenario({ cases: 4, replicates: 3, base: () => 0.9, candidate: () => 0.9 }),
    );
    expect(estimate.verdict).toBeNull();
    expect(estimate.power.run[0]).toMatchObject({ computed: true, applicableCases: 4 });
    const inconclusive = await run(
      await scenario({
        cases: 10,
        replicates: 2,
        base: () => 0.8,
        candidate: () => 0.8,
        margin: 0.2,
      }),
    );
    expect(inconclusive.verdict).toBeNull();
    expect(inconclusive.power.run[0]).toMatchObject({ computed: true, applicableCases: 10 });
  });
});
