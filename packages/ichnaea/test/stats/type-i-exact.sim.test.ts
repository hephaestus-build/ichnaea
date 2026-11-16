// Simulation study under the two-stage validation rule (VALIDATION.md, decision 0006). Every experiment goes through
// the functions compareCounts uses. Seeds: 1–999 coverage, 1000–1999 type-I, 9000+ the checks of
// the check; confirmations add CONFIRM_SEED_OFFSET, so no two experiments share a stream.
import { describe, expect, it } from "vitest";

import { exactStratifiedTest, fixedCasesInterval } from "../../src/stats/index.ts";
import { exactTypeI } from "./support/exact.ts";
import { clamp, draw, LEVEL, rates } from "./support/grid.ts";
import { documented } from "./support/documented.ts";
import { judge, type Point, TYPE_I } from "./support/simulate.ts";

describe("fixed-cases: the regression tests compareCounts uses", () => {
  it("the exact stratified conditional test keeps type-I error at or below 5%", () => {
    const points: Point[] = [];
    let seed = 1000;
    for (const [k, r] of [
      [5, 2],
      [5, 3],
      [6, 2],
      [6, 3],
      [7, 2],
      [8, 2],
      [9, 2],
    ] as const) {
      for (const p of [0.3, 0.5, 0.7, 0.9]) {
        points.push({ label: `k=${k} r=${r} p=${p}`, seed: 0, exact: exactTypeI(k, r, p) });
      }
    }
    for (const k of [17, 60]) {
      for (const r of [2, 3]) {
        for (const scenario of ["0.7", "0.9", "mixture", "low"]) {
          const base = rates(k, scenario);
          points.push({
            label: `k=${k} r=${r} ${scenario}`,
            seed: seed++,
            run: (rng) =>
              exactStratifiedTest(
                fixedCasesInterval(
                  draw(rng, base, base, () => r),
                  LEVEL,
                ).strata,
                "less",
              ).p <= 0.05,
          });
        }
      }
    }
    const het = rates(60, "0.8");
    points.push({
      label: "k=60 r=3 heterogeneous effects, mean 0",
      seed: seed++,
      run: (rng) =>
        exactStratifiedTest(
          fixedCasesInterval(
            draw(
              rng,
              het,
              het.map((p, i) => clamp(p + (i % 2 === 0 ? 0.1 : -0.1))),
              () => 3,
            ),
            LEVEL,
          ).strata,
          "less",
        ).p <= 0.05,
    });
    const verdict = judge(points, TYPE_I, "exact stratified test, type-I error");
    expect(verdict.failures).toEqual([]);
    // VALIDATION.md, "Results of the CI gate", states this result.
    const { run, page } = documented(TYPE_I, verdict);
    expect(run).toEqual(page);
  });
});
