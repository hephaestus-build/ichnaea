// REQ-51: non-inferiority per measure at the unadjusted level (intersection-union), Holm only over
// the tests that can produce REGRESSION.
import {
  type CaseCounts,
  holm,
  MARGIN_FLOOR_NOT_SET,
  VALIDATED_MARGIN_FLOOR,
} from "@hephaestus-build/ichnaea-stats";
import { describe, expect, it } from "vitest";

import { decidePrimariesWith } from "../src/decide.ts";
import { decidePrimaries, type PrimaryCounts } from "../src/index.ts";
import { floorSet } from "./support/floor-set.ts";

/** n cases with r trials; the base passes every trial, the candidate fails one in `fails` cases. */
const counts = (n: number, r: number, fails: number): CaseCounts[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${String(i).padStart(3, "0")}`,
    base: { successes: r, trials: r },
    candidate: { successes: i < fails ? r - 1 : r, trials: r },
  }));
const measure = (id: string, cases: CaseCounts[], margin: number): PrimaryCounts => ({
  measure: id,
  margin,
  valueType: "binary",
  cases,
});
const decideAll = (measures: PrimaryCounts[], alpha = 0.05) =>
  decidePrimaries({ estimand: "fixed-cases", alpha, seed: 1, measures });
/** The same rule, as if the margin floor were set. */
const decideFloorSet = (measures: PrimaryCounts[], alpha = 0.05) =>
  decidePrimariesWith({ estimand: "fixed-cases", alpha, seed: 1, measures }, floorSet);
const four = (margin: number) =>
  ["app/a", "app/b", "app/c", "app/d"].map((id) => measure(id, counts(60, 3, 6), margin));

describe("intersection-union and Holm (REQ-51)", () => {
  it("four primaries, each non-inferior at α but not at α/4, PASS once non-inferiority is validated", () => {
    const margin = 0.08;
    expect(margin).toBeGreaterThanOrEqual(VALIDATED_MARGIN_FLOOR);
    const verdicts = decideFloorSet(four(margin));
    for (const v of verdicts.values()) {
      expect(v.comparison?.regression.validated).toBe(true);
      expect(v.comparison?.nonInferiority.validated).toBe(true);
      expect(v.comparison?.nonInferiorityP).toBeGreaterThan(0.05 / 4);
      expect(v.comparison?.nonInferiorityP).toBeLessThan(0.05);
      // The raw regression p-value rejects; Holm across the four does not.
      expect(v.comparison?.regressionP).toBeLessThan(0.05);
      expect(v.regressionPAdjusted).toBeGreaterThan(0.05);
      expect(v.verdict).toBe("NON-INFERIOR");
    }
  });

  it("while the margin floor is not set, the same four are INCONCLUSIVE, and Holm still covers them", () => {
    const verdicts = decideAll(four(0.08));
    const raw = [...verdicts.values()].map((v) => v.comparison?.regressionP as number);
    // The family is the comparisons whose regression result is validated: all four.
    expect([...verdicts.values()].map((v) => v.regressionPAdjusted)).toEqual(holm(raw));
    for (const v of verdicts.values()) {
      expect(v.comparison?.regression.validated).toBe(true);
      expect(v.comparison?.nonInferiority).toEqual({
        validated: false,
        limitations: [MARGIN_FLOOR_NOT_SET],
      });
      expect(v).toMatchObject({
        verdict: "INCONCLUSIVE",
        cause: "non-inferiority-unvalidated",
        notes: [`the non-inferiority result is not validated: ${MARGIN_FLOOR_NOT_SET}`],
      });
    }
  });

  it("Holm covers only validated comparisons, which alone can produce REGRESSION", () => {
    // One validated comparison regresses with raw p in (α/4, α); three tiny ones are unvalidated.
    const verdicts = decideAll([
      measure("app/a", counts(60, 3, 5), 0.05),
      ...["app/b", "app/c", "app/d"].map((id) => measure(id, counts(4, 3, 0), 0.05)),
    ]);
    const a = verdicts.get("app/a");
    expect(a?.comparison?.regressionP).toBeGreaterThan(0.05 / 4);
    expect(a?.regressionPAdjusted).toBe(a?.comparison?.regressionP);
    expect(a?.verdict).toBe("REGRESSION");
    for (const id of ["app/b", "app/c", "app/d"])
      expect(verdicts.get(id)).toMatchObject({ verdict: "INCONCLUSIVE", cause: "unvalidated" });
  });

  it("an adjusted p-value equal to α rejects", () => {
    const cases = counts(60, 3, 6);
    const p = decideAll([measure("app/a", cases, 0.05)]).get("app/a")?.comparison
      ?.regressionP as number;
    const at = decideAll([measure("app/a", cases, 0.05)], p).get("app/a");
    expect(at?.regressionPAdjusted).toBe(p);
    expect(at?.verdict).toBe("REGRESSION");
  });
});
