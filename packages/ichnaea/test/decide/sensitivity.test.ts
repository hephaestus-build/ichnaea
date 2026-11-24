// REQ-56, decision 0010: whenever a primary measure misses a trial in either arm, each verdict is
// tested against the imputation that works against it, and a verdict that changes is INCONCLUSIVE.
import type { Decision } from "../../src/contracts/index.ts";
import { describe, expect, it } from "vitest";

import { decide } from "../../src/decide/index.ts";
import { decideFloorSet, FLOOR_REASON } from "./support/floor-set.ts";
import { type Scenario, scenario } from "./support/scenario.ts";

const run = (s: Scenario): Decision =>
  decide({ ...s, decidedAt: "2026-11-15T12:00:00Z", ichnaea: "0.0.0" });
const index = (c: string): number => Number(c.slice(5));

describe("the sensitivity analysis for missing trials (REQ-56)", () => {
  it("runs when both arms miss the same number of trials, and keeps the fixture from passing", async () => {
    // 6 cases lose the candidate's 2 failing trials of 3; 12 passing base trials of other cases are
    // lost too, so both arms miss 12.
    const s = await scenario({
      cases: 60,
      replicates: 3,
      base: () => 1,
      candidate: () => 1,
      margin: 0.05,
      outcome: (t) => {
        const i = index(t.case);
        if (t.arm === "candidate" && i < 6 && t.replicate > 0) return "infrastructure_failure";
        if (t.arm === "base" && i >= 30 && i < 42 && t.replicate === 0)
          return "infrastructure_failure";
        return undefined;
      },
    });
    const d = await decideFloorSet(s);
    expect(d.missingness.byArm.map((a) => a.missing)).toEqual([12, 12]);
    expect(d.missingness).toMatchObject({ differs: false, sensitivity: "changes-verdict" });
    expect(d.verdict).toBe("INCONCLUSIVE");
    expect(d.reason).toBe(
      "Measure app/correct could not be shown non-inferior: imputing its missing trials against the verdict changes it. This is not a pass.",
    );
    // The decision shows both results: the observed one and each imputation.
    const m = d.measures[0];
    expect(m?.comparisons[0]?.nonInferiority.validated).toBe(true);
    expect(m?.sensitivity.map((r) => [r.imputation, r.verdict, r.changesVerdict])).toEqual([
      ["against-non-inferiority", "INCONCLUSIVE", true],
      ["against-regression", "NON-INFERIOR", false],
    ]);
    // While the floor is not set, the observed verdict is INCONCLUSIVE, so no imputation can change
    // it; each imputation still carries both results. The reason does not blame the floor alone:
    // with the floor set, the imputation would still keep the measure from NON-INFERIOR.
    const unset = await run(s);
    expect(unset.verdict).toBe("INCONCLUSIVE");
    expect(unset.reason).not.toBe(FLOOR_REASON);
    expect(unset.reason).toBe(
      "Measure app/correct could not be shown non-inferior: with its missing trials imputed against non-inferiority, the cases cannot tell yet, and the validated margin floor is not set. This is not a pass.",
    );
    expect(unset.missingness.sensitivity).toBe("unchanged");
    expect(
      unset.measures[0]?.sensitivity.map((r) => [
        r.imputation,
        r.verdict,
        r.changesVerdict,
        r.regression.validated,
        r.nonInferiority.validated,
      ]),
    ).toEqual([
      ["against-non-inferiority", "INCONCLUSIVE", false, true, false],
      ["against-regression", "INCONCLUSIVE", false, true, false],
    ]);
  });

  it("does not report a drop that depends on missing trials", async () => {
    // Only the base misses trials: 10 cases lose 1 of 3 base trials, and the candidate fails one of
    // 3 trials in exactly those cases. The observed data show a drop. Imputed as failures, the
    // missing base trials make the base as good as the candidate there, and the drop is gone.
    const d = await run(
      await scenario({
        cases: 60,
        replicates: 3,
        base: () => 1,
        candidate: () => 1,
        margin: 0.05,
        outcome: (t) =>
          t.arm === "base" && index(t.case) < 10 && t.replicate === 2
            ? "infrastructure_failure"
            : undefined,
        value: (t) => (t.arm === "candidate" && index(t.case) < 10 ? t.replicate !== 0 : undefined),
      }),
    );
    expect(d.missingness.byArm.map((a) => a.missing)).toEqual([10, 0]);
    const m = d.measures[0];
    expect(m?.comparisons[0]?.regressionPAdjusted as number).toBeLessThan(0.05);
    // Imputed against the regression, the drop is gone: INCONCLUSIVE, since no non-inferiority
    // result is validated while the margin floor is not set.
    expect(m?.sensitivity.find((s) => s.imputation === "against-regression")).toMatchObject({
      verdict: "INCONCLUSIVE",
      changesVerdict: true,
    });
    expect(m?.verdict).toBe("INCONCLUSIVE");
    expect(d.verdict).toBe("INCONCLUSIVE");
  });

  it("does not run when no primary measure misses a trial", async () => {
    const d = await run(
      await scenario({ cases: 30, replicates: 2, base: () => 0.9, candidate: () => 0.9 }),
    );
    expect(d.missingness.sensitivity).toBe("not-needed");
    expect(d.measures[0]?.sensitivity).toEqual([]);
  });
});
