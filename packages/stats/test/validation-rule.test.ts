// The validation rule itself (VALIDATION.md, "The bar"): each threshold is pinned at its edge, so
// a loosened rule fails here, and the rule is shown to fail the score test that the regression
// test replaced. Exact points and Bernoulli experiments with a known true rate; no method under
// test is simulated, so this runs in well under a second per check.
import { describe, expect, it } from "vitest";

import { fixedCasesInterval, scoreDifferenceTest } from "../src/index.ts";
import { exactGroups, type Group } from "./support/exact.ts";
import { LEVEL, rates } from "./support/grid.ts";
import {
  CONFIRM_SE,
  CONFIRM_SEED_OFFSET,
  COVERAGE,
  judge,
  type Point,
  REPS,
  TYPE_I,
} from "./support/simulate.ts";

const exact = (label: string, value: number): Point => ({ label, seed: 0, exact: value });
/** A Bernoulli experiment whose true probability is `p`. */
const bernoulli = (label: string, p: number, seed: number): Point => ({
  label,
  seed,
  run: (rng) => rng.uniform() < p,
});
const fails = (points: Point[], rule: typeof COVERAGE): boolean =>
  judge(points, rule, "probe").failures.length > 0;

describe("the coverage rule", () => {
  it("fails an exact point below 0.94 and passes one at 0.94", () => {
    // The other points keep the grid mean far above 0.95, so only the per-point rule can fail.
    const pad = [exact("a", 0.99), exact("b", 0.99), exact("c", 0.99)];
    const low = judge([exact("low", 0.9399), ...pad], COVERAGE, "probe");
    expect(low.failures).toEqual(["low: exact 0.9399"]);
    expect(fails([exact("edge", 0.94), ...pad], COVERAGE)).toBe(false);
  });

  it("screens at 0.94 + 2·SE: a point just above passes without confirmation", () => {
    const s = Math.sqrt((0.95 * 0.05) / REPS);
    expect(COVERAGE.clears(0.94 + 2 * s, s)).toBe(true);
    expect(COVERAGE.clears(0.94 + 1.99 * s, s)).toBe(false);
  });

  it("fails a confirmed point whose estimate + 3·SE is below 0.94", () => {
    expect(COVERAGE.fails(0.9384, 0.0005)).toBe(true);
    expect(COVERAGE.fails(0.9386, 0.0005)).toBe(false);
  });

  it("confirms to SE ≤ 0.0005: a true 0.937 fails and a true 0.9395 passes", () => {
    expect(fails([bernoulli("true 0.936", 0.936, 11)], COVERAGE)).toBe(true);
    expect(fails([bernoulli("true 0.937", 0.937, 12)], COVERAGE)).toBe(true);
    // Grid-mean rule out of the way: the other points are exact at 0.96.
    const passing = [bernoulli("true 0.9395", 0.9395, 13), exact("a", 0.96), exact("b", 0.96)];
    const verdict = judge(passing, COVERAGE, "probe");
    expect(verdict.failures).toEqual([]);
    const confirmed = verdict.estimates.find((e) => e.label === "true 0.9395");
    expect(confirmed?.stage).toBe("confirmed");
    expect(confirmed?.se).toBeLessThanOrEqual(CONFIRM_SE);
  });

  it("fails a grid whose mean is below 0.95, though every point passes", () => {
    expect(fails([exact("a", 0.945), exact("b", 0.945)], COVERAGE)).toBe(true);
    expect(fails([exact("a", 0.95), exact("b", 0.95)], COVERAGE)).toBe(false);
  });

  it("fails a coverage grid with more than 12 candidates without confirming them", () => {
    // True 0.93 screens far below 0.94 + 2·SE, so all 13 points are candidates.
    const points = Array.from({ length: 13 }, (_, i) => bernoulli(`true 0.93 #${i}`, 0.93, 40 + i));
    const verdict = judge(points, COVERAGE, "probe");
    expect(verdict.failures.join(" ")).toMatch(/13 candidates at screening, more than 12/);
    expect(verdict.estimates.every((e) => e.stage === "screen")).toBe(true);
  });

  it("confirms with an independent stream: the point's seed plus the offset", () => {
    expect(CONFIRM_SEED_OFFSET).toBe(100_000);
    const seeds = new Set<number>();
    const point: Point = {
      label: "candidate",
      seed: 7,
      run: (rng) => {
        seeds.add(rng.seed);
        return rng.uniform() < 0.93;
      },
    };
    judge([point], COVERAGE, "probe");
    expect([...seeds].toSorted((a, b) => a - b)).toEqual([7, 7 + CONFIRM_SEED_OFFSET]);
  });
});

describe("the type-I rule", () => {
  it("fails an exact point above 0.05 and passes one at 0.05", () => {
    expect(fails([exact("0.0501", 0.0501)], TYPE_I)).toBe(true);
    expect(fails([exact("0.05", 0.05)], TYPE_I)).toBe(false);
  });

  it("confirms to SE ≤ 0.0005: a true 0.0527 fails and a true 0.0505 passes", () => {
    expect(fails([bernoulli("true 0.0527", 0.0527, 21)], TYPE_I)).toBe(true);
    expect(fails([bernoulli("true 0.0505", 0.0505, 22)], TYPE_I)).toBe(false);
  });

  it("confirms every candidate, however many there are", () => {
    const points = Array.from({ length: 20 }, (_, i) =>
      bernoulli(`true 0.049 #${i}`, 0.049, 30 + i),
    );
    const verdict = judge(points, TYPE_I, "probe");
    expect(verdict.failures).toEqual([]);
    expect(verdict.estimates.filter((e) => e.stage === "confirmed").length).toBeGreaterThan(12);
  });

  it("fails the score test at 0 as a regression test: exactly 0.0525 at 17 cases, 2 trials", () => {
    // The mixture point of the type-I grid: 12 cases at rate 1, 3 at 0.8, 2 at 0.3, both arms equal.
    const groups: Group[] = [...new Set(rates(17, "mixture"))].map((p) => ({
      count: rates(17, "mixture").filter((q) => q === p).length,
      base: p,
      candidate: p,
      baseTrials: 2,
      candidateTrials: 2,
    }));
    const size = exactGroups(groups, (cases) => {
      const { strata, options } = fixedCasesInterval(cases, LEVEL);
      return scoreDifferenceTest(strata, 0, "less", options).p <= 0.05;
    });
    expect(size).toBeCloseTo(0.0525, 4);
    expect(fails([exact("score test at 0, k=17 r=2 mixture", size)], TYPE_I)).toBe(true);
  });
});
