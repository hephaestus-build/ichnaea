// REQ-54, decision 0014: the power statement of a decision.
import type { Decision } from "@hephaestus-build/ichnaea-contracts";
import { describe, expect, it } from "vitest";

import { decide, planningPower } from "../src/index.ts";
import { type Scenario, type ScenarioOptions, scenario } from "./support/scenario.ts";

const run = (s: Scenario): Promise<Decision> =>
  decide({ ...s, decidedAt: "2026-11-15T12:00:00Z", ichnaea: "0.0.0" });
/** The scenario with the planning statement that the decide plugin adds before any call. */
async function planned(o: ScenarioOptions): Promise<Scenario> {
  const s = await scenario(o);
  const { digest } = await import("@hephaestus-build/ichnaea-contracts");
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
    // The base loses a third of its trials, below the coverage floor: its rates are not trusted.
    const d = await run(
      await scenario({
        ...stable,
        outcome: (t) =>
          t.arm === "base" && t.replicate === 0 ? "infrastructure_failure" : undefined,
      }),
    );
    expect(d.verdict).toBe("INVALID");
    expect(d.reason).toMatch(/coverage 66\.7% is below its floor/);
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
    expect(d.mode).toBe("decision");
    expect(d.verdict).toBe("REGRESSION");
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
    expect(inconclusive.verdict).toBe("INCONCLUSIVE");
    expect(inconclusive.power.run[0]).toMatchObject({ computed: true, applicableCases: 10 });
  });
});
