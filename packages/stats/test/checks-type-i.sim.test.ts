// Simulation study under the two-stage rule of DC-7 (VALIDATION.md). Every experiment goes through
// the functions compareCounts uses. Seeds: 1–999 coverage, 1000–1999 type-I, 9000+ the checks of
// the check; confirmations add CONFIRM_SEED_OFFSET, so no two experiments share a stream.
import { describe, expect, it } from "vitest";

import { fixedCasesInterval, type Rng, scoreDifferenceTest } from "../src/index.ts";
import { draw, LEVEL, rates } from "./support/grid.ts";
import { estimate, judge, type Point, REPS, TYPE_I } from "./support/simulate.ts";

describe("the type-I check detects a test that misses the bar (REQ-111)", () => {
  it("fails the score test at 0 without the N/(N−1) factor as a regression test", () => {
    // Screen the type-I grid and confirm the worst point. With the factor and equal case weights
    // the score test at 0 stays at or below 0.05 on this grid (worst 0.0498 ± 0.0005, VALIDATION.md),
    // so the check of the check uses the variant without it.
    let seed = 9100;
    const points: Point[] = [17, 60].flatMap((k) =>
      [2, 3].flatMap((r) =>
        ["0.7", "0.9", "mixture", "low"].map((scenario): Point => {
          const base = rates(k, scenario);
          return {
            label: `score test at 0 without the factor, k=${k} r=${r} ${scenario}`,
            seed: seed++,
            run: (rng) => {
              const { strata, options } = fixedCasesInterval(
                draw(rng, base, base, () => r),
                LEVEL,
              );
              return (
                scoreDifferenceTest(strata, 0, "less", { ...options, biasCorrection: false }).p <=
                0.05
              );
            },
          };
        }),
      ),
    );
    const worst = points
      .map((p) => ({ p, value: estimate(p.run as (rng: Rng) => boolean, p.seed, REPS) }))
      .toSorted((a, b) => b.value - a.value)[0]?.p as Point;
    expect(
      judge([worst], TYPE_I, "score test at 0 without the factor (must fail)").failures.length,
    ).toBeGreaterThan(0);
  });
});
