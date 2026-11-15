// Simulation study under the two-stage validation rule (VALIDATION.md, decision 0006). Every experiment goes through
// the functions compareCounts uses. Seeds: 1–999 coverage, 1000–1999 type-I, 9000+ the checks of
// the check; confirmations add CONFIRM_SEED_OFFSET, so no two experiments share a stream.
import { describe, expect, it } from "vitest";

import { fixedCasesInterval, scoreDifferenceInterval } from "../src/index.ts";
import { draw, LEVEL, rates } from "./support/grid.ts";
import { documented } from "./support/documented.ts";
import { COVERAGE, judge, type Point } from "./support/simulate.ts";

describe("the coverage check detects methods that miss the bar (REQ-111)", () => {
  it("fails a lower bound shifted up by 2 points", () => {
    const base = rates(17, "0.9");
    const point: Point = {
      label: "bound + 0.02, k=17 r=2 p=0.9",
      seed: 9001,
      run: (rng) =>
        fixedCasesInterval(
          draw(rng, base, base, () => 2),
          LEVEL,
        ).interval.lower +
          0.02 <=
        0,
    };
    const verdict = judge([point], COVERAGE, "biased bound (must fail)");
    expect(verdict.failures.length).toBeGreaterThan(0);
    // VALIDATION.md, "Results of the CI gate", states this result.
    const { run, page } = documented(COVERAGE, verdict);
    expect(run).toEqual(page);
  });

  it("fails the variant without the N/(N−1) factor at 2 trials per case and arm", () => {
    const base = rates(17, "0.9");
    const point: Point = {
      label: "Mee, k=17 r=2 p=0.9",
      seed: 9002,
      run: (rng) =>
        scoreDifferenceInterval(
          fixedCasesInterval(
            draw(rng, base, base, () => 2),
            LEVEL,
          ).strata,
          LEVEL,
          "lower",
          { biasCorrection: false, weights: "equal" },
        ).lower <= 0,
    };
    const verdict = judge([point], COVERAGE, "variant without the factor (must fail)");
    expect(verdict.failures.length).toBeGreaterThan(0);
    // VALIDATION.md, "Results of the CI gate", states this result.
    const { run, page } = documented(COVERAGE, verdict);
    expect(run).toEqual(page);
  });
});
