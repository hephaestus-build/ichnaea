import { describe, expect, it } from "vitest";

import { decide, exitCode } from "../../src/decide/index.ts";
import { decisionView, renderHtml, renderMarkdown } from "../../src/report/index.ts";

import { scenario, type Scenario } from "./support/scenario.ts";

const decideRun = (s: Scenario) =>
  decide({ ...s, decidedAt: "2026-11-24T12:00:00Z", ichnaea: "0.0.0" });

describe("claims from a single run", () => {
  it("reports the adverse face of a run-wide coin shock as a drop in these runs", async () => {
    const adverseCoin = await scenario({
      cases: 60,
      replicates: 3,
      base: () => 1,
      candidate: () => 0,
      measures: ["app/a", "app/b"],
    });
    const decision = decideRun(adverseCoin);
    expect(decision).toMatchObject({
      verdict: "INCONCLUSIVE",
      reasonCode: "DROP_IN_THESE_RUNS_ONLY",
    });
    expect(decision.reason).toBe("Measures app/a and app/b dropped in these runs.");
    expect(decision.measures.map((measure) => measure.verdict)).toEqual([
      "INCONCLUSIVE",
      "INCONCLUSIVE",
    ]);
    for (const measure of decision.measures)
      expect(measure.notes).toContain("A drop was detected in these runs.");

    const policy = adverseCoin.plan.policy;
    expect(exitCode(decision, { ...policy, onInconclusive: "report", onRunDrop: "block" })).toBe(1);
    expect(exitCode(decision, { ...policy, onInconclusive: "block", onRunDrop: "report" })).toBe(0);

    const view = decisionView(decision, "synthetic");
    for (const report of [renderMarkdown(view), renderHtml(view)]) {
      expect(report).toContain("Ichnaea can show that a change failed a hard gate");
      expect(report).not.toContain("run-to-run noise");
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
