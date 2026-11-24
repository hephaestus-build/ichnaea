// Decision 0015: REGRESSION needs the regression result validated; NON-INFERIOR, and so PASS,
// needs both results. While the validated margin floor is not set, no run passes, and a real drop
// still blocks.
import type { Decision } from "../../src/contracts/index.ts";
import {
  type CaseCounts,
  MARGIN_FLOOR_NOT_SET,
  VALIDATED_MARGIN_FLOOR_SET,
} from "../../src/stats/index.ts";
import { describe, expect, it } from "vitest";

import { decide, decidePrimaries, exitCode, FLOOR_NOT_SET_REASON } from "../../src/decide/index.ts";
import { type Scenario, scenario } from "./support/scenario.ts";

const run = (s: Scenario): Decision =>
  decide({ ...s, decidedAt: "2026-11-15T12:00:00Z", ichnaea: "0.0.0" });

describe("while the validated margin floor is not set (decision 0015)", () => {
  // When the floor is set, these tests no longer describe the code: revisit them with it.
  it("the statistics package says so", () => {
    expect(VALIDATED_MARGIN_FLOOR_SET).toBe(false);
  });

  it("a detected drop blocks when the suite opts in", async () => {
    const s = await scenario({
      cases: 60,
      replicates: 3,
      base: () => 0.95,
      candidate: () => 0.85,
      margin: 0.05,
    });
    const d = await run(s);
    expect(d.reasonCode).toBe("DROP_IN_THESE_RUNS_ONLY");
    expect(d.measures[0]?.comparisons[0]).toMatchObject({
      regression: { validated: true, limitations: [] },
      nonInferiority: { validated: false, limitations: [MARGIN_FLOOR_NOT_SET] },
    });
    expect(d.measures[0]?.comparisons[0]?.regressionPAdjusted as number).toBeLessThanOrEqual(0.05);
    expect(exitCode(d, { ...s.plan.policy, onRunDrop: "block" })).toBe(1);
  });

  it("the counts-only API detects drops without returning a regression verdict", () => {
    const reasons = new Set<string | undefined>();
    for (const n of [5, 17, 60])
      for (const r of [2, 3])
        for (const base of [r, r - 1])
          for (const change of [-2, -1, 0, 1])
            for (const margin of [0.05, 0.15, 0.3]) {
              const cases: CaseCounts[] = Array.from({ length: n }, (_, i) => ({
                id: `c${i}`,
                base: { successes: base, trials: r },
                candidate: {
                  successes: Math.max(0, Math.min(r, base + (i % 2 === 0 ? change : 0))),
                  trials: r,
                },
              }));
              const v = decidePrimaries({
                estimand: "fixed-cases",
                alpha: 0.05,
                seed: 1,
                measures: [{ measure: "app/m", margin, valueType: "binary", cases }],
              }).get("app/m");
              reasons.add(v?.reasonCode);
              expect(v?.verdict, JSON.stringify({ n, r, base, change, margin })).toBe(
                "INCONCLUSIVE",
              );
              expect(v?.comparison?.nonInferiority.limitations).toContain(MARGIN_FLOOR_NOT_SET);
            }
    expect(reasons).toEqual(new Set([undefined, "DROP_IN_THESE_RUNS_ONLY"]));
  });

  it("an unchanged candidate is INCONCLUSIVE with the floor's reason, and a report policy lets it through", async () => {
    // Every trial passes, so the lower bound clears the margin: the floor is the only cause.
    const s = await scenario({ cases: 12, replicates: 3, base: () => 1, candidate: () => 1 });
    const d = await run(s);
    expect(d.verdict).toBe("INCONCLUSIVE");
    expect(d.measures[0]?.comparisons[0]?.difference.lower).toBeGreaterThan(-0.1);
    expect(d.reason).toBe(FLOOR_NOT_SET_REASON);
    expect(s.plan.policy.onInconclusive).toBe("report");
    expect(exitCode(d, s.plan.policy)).toBe(0);
  });
});
