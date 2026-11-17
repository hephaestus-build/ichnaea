// Every refined G2 cell accounts for each refinement step s from 500 to 599 exactly once
// (scripts/stats/collect-score-type-i.ts, `refinementProblems`): as a screen row, or as a step the
// screen recorded as skipped because its perturbation left [0.01, 0.99]. A screen that ran only part
// of the refinement fails, naming the cell and the step.
import { describe, expect, it } from "vitest";

import { refinementProblems, type Row } from "../../scripts/stats/collect-score-type-i.ts";

const CELL = "G2/top-nu2/k12-r2";
const refinable = new Set([CELL]);
const steps = (from: number, to: number): Row[] =>
  Array.from({ length: to - from }, (_, i) => ({ id: `${CELL}/s${from + i}` }));
const grid: Row[] = steps(0, 500);

describe("refinement steps are all accounted for", () => {
  it("accepts 100 step rows", () => {
    expect(refinementProblems([...grid, ...steps(500, 600)], {}, refinable)).toEqual([]);
  });

  it("refuses a screen with a step row removed, naming the cell and the step", () => {
    const rows = [...grid, ...steps(500, 600)].filter((r) => r["id"] !== `${CELL}/s537`);
    expect(refinementProblems(rows, {}, refinable)).toEqual([
      `${CELL}: refinement step 537 is neither a row nor a recorded skip`,
    ]);
  });

  it("refuses a screen that ran no refinement", () => {
    expect(refinementProblems(grid, {}, refinable)).toHaveLength(100);
  });

  it("accepts a step the screen recorded as skipped", () => {
    const rows = [...grid, ...steps(500, 600)].filter((r) => r["id"] !== `${CELL}/s537`);
    expect(refinementProblems(rows, { [CELL]: [537] }, refinable)).toEqual([]);
  });

  it("refuses a step that is both a row and a skip, a skip outside 500–599, and a skip of an unrefined cell", () => {
    const rows = [...grid, ...steps(500, 600)];
    expect(refinementProblems(rows, { [CELL]: [512] }, refinable)).toEqual(
      expect.arrayContaining([
        `${CELL}: refinement step 512 is both a row and a recorded skip`,
        `${CELL}: refinement step 512 appears 2 times`,
      ]),
    );
    expect(refinementProblems(rows, { [CELL]: [600] }, refinable)).toContain(
      `${CELL}: refinement step 600 is outside 500–599`,
    );
    expect(refinementProblems(rows, { "G1/x": [500] }, refinable)).toContain(
      "G1/x: skipped refinement steps recorded for a cell that is not refined",
    );
  });
});
