// A missing bound never switches the bounds off: a new plan that runs arms carries the suite's
// bound of calls per trial, and decide applies it. An import plan runs no arm, so it needs none.
import { describe, expect, it } from "vitest";

import type { Suite } from "../../src/contracts/index.ts";
import { createPlan, PlanError, type PlanInput } from "../../src/core/index.ts";
import { decide } from "../../src/decide/index.ts";
import { card, scenario } from "../decide/support/scenario.ts";

const s = await scenario({ cases: 8, replicates: 2, base: () => 1, candidate: () => 1 });
const input: PlanInput = {
  suite: s.suite,
  caseSet: s.caseSet,
  cases: s.cases,
  arms: s.plan.arms.map((a) => ({ name: a.name, role: a.role, configuration: a.configuration })),
  measures: new Map([["app/correct", card("app/correct")]]),
  gates: new Map(),
  trigger: "code",
  seed: 7,
  now: "2026-11-15T10:00:00Z",
  ichnaea: "0.0.0",
};
const { callsPerTrial: _, ...unbounded } = s.suite.budget;
const withoutBound = { ...s.suite, budget: unbounded } as unknown as Suite;

describe("a new plan's bound of calls per trial", () => {
  it("is refused when a plan that runs arms has a suite without one", async () => {
    const refused = createPlan({ ...input, suite: withoutBound });
    await expect(refused).rejects.toThrow(PlanError);
    await expect(refused).rejects.toThrow("budget.callsPerTrial");
  });

  it("is not needed by an import plan, which runs no arm", async () => {
    const plan = await createPlan({ ...input, suite: withoutBound, armsToRun: [] });
    expect(plan.budget.worstCaseCalls).toBe(0);
    expect(plan.budget.callsPerTrial).toBeUndefined();
  });

  it("is the suite's, and decide applies it: a trial over it makes the run INVALID", async () => {
    expect(s.plan.budget.callsPerTrial).toBe(s.suite.budget.callsPerTrial);
    const over = await scenario({
      cases: 8,
      replicates: 2,
      base: () => 1,
      candidate: () => 1,
      usage: (t) => ({ calls: t.case === "case-001" && t.arm === "base" ? 2 : 1 }),
    });
    const d = decide({ ...over, decidedAt: "2026-11-15T12:00:00Z", ichnaea: "0.0.0" });
    expect(d.verdict).toBe("INVALID");
    expect(d.invalidReasons[0]).toMatch(
      /^2 trial\(s\) made more calls over their attempts than the bound of 1 per trial/,
    );
  });
});
