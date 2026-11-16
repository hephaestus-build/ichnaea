// Simulation study under the two-stage validation rule (VALIDATION.md, decision 0006). Every experiment goes through
// the functions compareCounts uses. Seeds: 1–999 coverage, 1000–1999 type-I, 9000+ the checks of
// the check; confirmations add CONFIRM_SEED_OFFSET, so no two experiments share a stream.
import { describe, expect, it } from "vitest";

import { fixedCasesInterval, withinCasePermutationTest } from "../src/index.ts";
import { draw, LEVEL, rates } from "./support/grid.ts";
import { documented } from "./support/documented.ts";
import { judge, type Point, TYPE_I } from "./support/simulate.ts";

/**
 * Resamples per permutation test in the type-I study. A Monte Carlo permutation p-value
 * (1 + count) / (1 + B) has level at most alpha for every B with (1 + B)·alpha a whole number, so
 * 99 resamples study the same property as the decision's 10,000 at a fraction of the cost.
 */
const PERMUTATION_RESAMPLES = 99;

describe("fixed-cases: the within-case permutation test", () => {
  it("the within-case permutation test (unequal trial counts) keeps type-I error at or below 5%", () => {
    const points: Point[] = [];
    let seed = 1500;
    for (const k of [17]) {
      for (const scenario of ["0.7", "0.9", "mixture"]) {
        const base = rates(k, scenario);
        const patterns: Array<[string, (j: number) => number, (j: number) => number]> = [
          ["r=2..3", (j) => 2 + (j % 2), () => 0],
          ["r=3, every tenth case loses 2", () => 3, (j) => (j % 10 === 0 ? 2 : 0)],
        ];
        for (const [name, r, lose] of patterns) {
          points.push({
            label: `k=${k} ${name} ${scenario}`,
            seed: seed++,
            run: (rng) =>
              withinCasePermutationTest(
                fixedCasesInterval(draw(rng, base, base, r, lose), LEVEL).strata,
                rng,
                PERMUTATION_RESAMPLES,
              ).p <= 0.05,
          });
        }
      }
    }
    const verdict = judge(points, TYPE_I, "within-case permutation test, 17 cases, type-I error");
    expect(verdict.failures).toEqual([]);
    // VALIDATION.md, "Results of the CI gate", states this result.
    const { run, page } = documented(TYPE_I, verdict);
    expect(run).toEqual(page);
  });
});
