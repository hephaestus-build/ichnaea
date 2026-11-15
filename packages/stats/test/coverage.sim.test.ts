// Simulation study under the two-stage validation rule (VALIDATION.md, decision 0006). Every experiment goes through
// the functions compareCounts uses. Seeds: 1–999 coverage, 1000–1999 type-I, 9000+ the checks of
// the check; confirmations add CONFIRM_SEED_OFFSET, so no two experiments share a stream.
import { describe, expect, it } from "vitest";

import { fixedCasesInterval } from "../src/index.ts";
import { exactCoverage, exactPatternCoverage, type Pattern } from "./support/exact.ts";
import { clamp, draw, LEVEL, rates, truthOf } from "./support/grid.ts";
import { binomial, COVERAGE, judge, type Point, REPS } from "./support/simulate.ts";

const pattern = (count: number, candidateTrials: number, baseTrials: number): Pattern => ({
  count,
  candidateTrials,
  baseTrials,
});

describe("fixed-cases: the one-sided lower bound compareCounts reports", () => {
  it(`holds coverage under the validation rule (screening at ${REPS} repetitions)`, () => {
    const points: Point[] = [];
    let seed = 1;
    const mc = (
      label: string,
      base: number[],
      cand: number[],
      r: (j: number) => number,
      lose?: (j: number) => number,
    ): void => {
      const truth = truthOf(base, cand);
      points.push({
        label,
        seed: seed++,
        run: (rng) =>
          fixedCasesInterval(draw(rng, base, cand, r, lose), LEVEL).interval.lower <= truth + 1e-12,
      });
    };
    // 5 to 9 cases: exact, on a wide grid of rates and shifts (no Monte Carlo error).
    for (const [k, r] of [
      [5, 2],
      [5, 3],
      [6, 2],
      [6, 3],
      [7, 2],
      [7, 3],
      [8, 2],
      [8, 3],
      [9, 2],
      [12, 2],
      [13, 2],
    ] as const) {
      for (const p of [0.05, 0.2, 0.5, 0.7, 0.9, 0.99]) {
        for (const shift of [0.1, 0, -0.05, -0.1, -0.2, -0.3]) {
          const q = p + shift;
          if (q < 0 || q > 1) continue;
          points.push({
            label: `k=${k} r=${r} p=${p} shift=${shift}`,
            seed: 0,
            exact: exactCoverage(k, r, p, q, LEVEL),
          });
        }
      }
    }
    // Few cases with a one-trial cell, or arms with different trial counts: exact as well.
    for (const [label, patterns] of [
      ["k=5 r=2, one 1-trial cell", [pattern(4, 2, 2), pattern(1, 1, 2)]],
      ["k=5 r=3, one 1-trial cell", [pattern(4, 3, 3), pattern(1, 1, 3)]],
      ["k=9 r=2, one 1-trial cell", [pattern(8, 2, 2), pattern(1, 1, 2)]],
      ["k=5, candidate 2 trials against base 5", [pattern(5, 2, 5)]],
      ["k=6, 3 cases with r=2 and 3 with r=3", [pattern(3, 2, 2), pattern(3, 3, 3)]],
      [
        "k=10 r=2, one case with 1 trial per arm (10% of cells)",
        [pattern(9, 2, 2), pattern(1, 1, 1)],
      ],
      ["k=10 r=2, two 1-trial cells (10%)", [pattern(8, 2, 2), pattern(2, 1, 2)]],
    ] as const) {
      for (const p of [0.05, 0.2, 0.5, 0.7, 0.9, 0.99]) {
        for (const shift of [0.1, 0, -0.05, -0.1, -0.2, -0.3]) {
          const q = p + shift;
          if (q < 0 || q > 1) continue;
          points.push({
            label: `${label} p=${p} shift=${shift}`,
            seed: 0,
            exact: exactPatternCoverage(patterns, p, q, LEVEL),
          });
        }
      }
    }
    for (const k of [17, 60]) {
      for (const r of [2, 3]) {
        for (const scenario of ["0.7", "0.9", "0.97", "mixture", "low"]) {
          for (const shift of [0, -0.05]) {
            const base = rates(k, scenario);
            mc(
              `k=${k} r=${r} ${scenario} shift=${shift}`,
              base,
              base.map((p) => clamp(p + shift)),
              () => r,
            );
          }
        }
      }
    }
    const het = rates(40, "0.8");
    mc(
      "k=40 r=2 heterogeneous effects, mean −0.05",
      het,
      het.map((p, i) => clamp(p + (i % 2 === 0 ? 0.1 : -0.2))),
      () => 2,
    );
    // Missingness tied to the drop: degraded cases keep only one candidate trial (decision 0009).
    const high = rates(60, "0.95");
    mc(
      "k=60 r=3, 6 cases drop by 0.6 and lose 2 of 3",
      high,
      high.map((p, i) => (i < 6 ? p - 0.6 : p)),
      () => 3,
      (j) => (j < 6 ? 2 : 0),
    );
    mc(
      "k=60 r=3, 12 cases drop by 0.5 and lose 2 of 3",
      high,
      high.map((p, i) => (i < 12 ? p - 0.5 : p)),
      () => 3,
      (j) => (j < 12 ? 2 : 0),
    );
    // Missingness not tied to the drop.
    const mid = rates(60, "0.8");
    mc(
      "k=60 r=2, every tenth case loses 1, shift −0.05",
      mid,
      mid.map((p) => p - 0.05),
      () => 2,
      (j) => (j % 10 === 0 ? 1 : 0),
    );
    // Unequal trial counts (2 and 3), with the drop on the cases with fewest trials, and without one.
    for (const k of [8, 17, 60]) {
      const base = rates(k, "0.9");
      mc(
        `k=${k} r=2..3, drop of 0.2 on the r=2 cases`,
        base,
        base.map((p, j) => (j % 4 === 0 ? p - 0.2 : p)),
        (j) => 2 + (j % 2),
      );
      mc(`k=${k} r=2..3, no change`, base, base, (j) => 2 + (j % 2));
    }
    // A suite's own pattern: 3 trials on 17 of 60 cases, 2 on the rest.
    const suite = rates(60, "0.9");
    for (const shift of [0, -0.05])
      mc(
        `k=60, 3 trials on 17 cases and 2 on 43, shift=${shift}`,
        suite,
        suite.map((p) => clamp(p + shift)),
        (j) => (j < 17 ? 3 : 2),
      );
    // Between the exact points and 17 cases: 12 cases at r = 3 and r = 2..3, and one-trial cells
    // up to 10% at 17 cases. Exact enumeration costs too much here. New points go last, so the
    // seeds of the points above stay the same.
    for (const scenario of ["0.9", "mixture"]) {
      const base = rates(12, scenario);
      for (const shift of [0, -0.05]) {
        const cand = base.map((p) => clamp(p + shift));
        mc(`k=12 r=3 ${scenario} shift=${shift}`, base, cand, () => 3);
        mc(`k=12 r=2..3 ${scenario} shift=${shift}`, base, cand, (j) => 2 + (j % 2));
        const k17 = rates(17, scenario);
        mc(
          `k=17 r=2, 3 cases keep 1 candidate trial (9% of cells), ${scenario} shift=${shift}`,
          k17,
          k17.map((p) => clamp(p + shift)),
          () => 2,
          (j) => (j % 6 === 0 ? 1 : 0),
        );
      }
    }
    const verdict = judge(points, COVERAGE, "fixed-cases lower bound");
    expect(verdict.failures).toEqual([]);
  });

  it("misses the bar when every case has 2 trials in one arm and 3 in the other", () => {
    // Outside the gate above, and outside every validated result until the margin floor is set
    // (VALIDATION.md, "The validated domain"). The bound sits too high at a difference of 0. If a
    // change to the method makes these points pass, move the pattern into the gate.
    const at = (k: number, candidateTrials: number, baseTrials: number, p: number): Point => ({
      label: `k=${k}, candidate ${candidateTrials} trials against base ${baseTrials}, p=${p} shift=0`,
      seed: 0,
      exact: exactPatternCoverage([pattern(k, candidateTrials, baseTrials)], p, p, LEVEL),
    });
    const unequal = (
      k: number,
      candidateTrials: number,
      baseTrials: number,
      p: number,
      seed: number,
    ): Point => {
      const base = rates(k, String(p));
      return {
        label: `k=${k}, candidate ${candidateTrials} trials against base ${baseTrials}, p=${p} shift=0`,
        seed,
        run: (rng) =>
          fixedCasesInterval(
            base.map((q, j) => ({
              id: `c${j}`,
              candidate: { successes: binomial(rng, candidateTrials, q), trials: candidateTrials },
              base: { successes: binomial(rng, baseTrials, q), trials: baseTrials },
            })),
            LEVEL,
          ).interval.lower <= 1e-12,
      };
    };
    const points = [
      at(5, 3, 2, 0.9),
      at(6, 3, 2, 0.9),
      at(7, 3, 2, 0.9),
      at(9, 2, 3, 0.05),
      unequal(17, 2, 3, 0.05, 900),
      unequal(17, 3, 2, 0.95, 901),
    ];
    const verdict = judge(points, COVERAGE, "unequal arms in every case (must fail)");
    for (const point of points)
      expect(
        verdict.failures.some((f) => f.startsWith(`${point.label}:`)),
        point.label,
      ).toBe(true);
  });
});
