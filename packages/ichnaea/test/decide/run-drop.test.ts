import { describe, expect, it } from "vitest";

import { decide, exitCode } from "../../src/decide/index.ts";
import { report } from "../../src/report/index.ts";

import { scenario, type Scenario } from "./support/scenario.ts";

const decideRun = (s: Scenario) =>
  decide({ ...s, decidedAt: "2026-11-24T12:00:00Z", ichnaea: "0.0.0" });

describe("claims from a single run", () => {
  it("keeps a run without recorded draws estimate-only even after an adverse shock", async () => {
    const adverseCoin = await scenario({
      cases: 60,
      replicates: 3,
      base: () => 1,
      candidate: () => 0,
      measures: ["app/a", "app/b"],
    });
    const decision = decideRun(adverseCoin);
    expect(decision).toMatchObject({ mode: "estimate-only", verdict: null });
    expect(decision.measures.map((measure) => measure.verdict)).toEqual([
      "ESTIMATE-ONLY",
      "ESTIMATE-ONLY",
    ]);

    const policy = adverseCoin.plan.policy;
    expect(exitCode(decision, { ...policy, onEstimateOnly: "report", onRunDrop: "block" })).toBe(0);

    for (const format of ["markdown", "html"] as const) {
      const rendered = report({ ...adverseCoin, decision }, { format, suite: "synthetic" });
      expect(rendered).toContain("the run has no locked randomized assignments");
    }
  });

  it("still gives REGRESSION when a hard gate fails", async () => {
    const s = await scenario({
      cases: 60,
      replicates: 3,
      base: () => 1,
      candidate: () => 0,
      hardGates: ["app/schema"],
    });
    const gate = { gate: s.plan.hardGates[0]!, passed: false, failures: 1 };
    expect(decideRun({ ...s, gates: [gate] })).toMatchObject({
      verdict: "REGRESSION",
      cause: "gate",
    });
  });
});
