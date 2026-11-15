// Simulation studies of the fixed-cases methods the decision rule uses (REQ-50, REQ-58, REQ-111),
// under DC-5. Seeds: 1–999 coverage, 1000–1999 type-I, 9000+ the checks of the check itself.
// The sampled-cases methods and Wilson have their own studies (VALIDATION.md) and are not gated.
import { describe, expect, it } from "vitest";

import {
  exactStratifiedTest,
  scoreDifferenceInterval,
  type Interval,
  type Rng,
  type Stratum,
} from "../src/index.ts";
import { exactCoverage } from "./support/exact.ts";
import { binomial, coverage, judge, type PointResult, REPS } from "./support/simulate.ts";

const LEVEL = 0.95;

function rates(k: number, scenario: string): number[] {
  if (scenario === "mixture")
    return Array.from({ length: k }, (_, i) =>
      i < Math.round(0.7 * k) ? 1 : i < Math.round(0.9 * k) ? 0.8 : 0.3,
    );
  if (scenario === "low")
    return Array.from({ length: k }, (_, i) => 0.03 + (0.27 * i) / Math.max(1, k - 1));
  return Array.from({ length: k }, () => Number(scenario));
}

/** Draws per-case counts; `lose` drops candidate trials of a case (informative missingness). */
function draw(
  rng: Rng,
  base: readonly number[],
  cand: readonly number[],
  r: (j: number) => number,
  lose: (j: number) => number = () => 0,
): Stratum[] {
  return base.map((p, j) => {
    const nb = r(j);
    const nc = r(j) - lose(j);
    return {
      candidate: { successes: binomial(rng, nc, cand[j] as number), trials: nc },
      base: { successes: binomial(rng, nb, p), trials: nb },
    };
  });
}

/** The bound compareCounts reports for fixed-cases: equal case weights, the N/(N−1) factor. */
const lowerOf = (strata: Stratum[]): number =>
  scoreDifferenceInterval(strata, LEVEL, "lower").lower;

describe("fixed-cases: stratified Miettinen–Nurminen one-sided lower bound", () => {
  it(`holds coverage under DC-5 (${REPS} repetitions per point)`, () => {
    const results: PointResult[] = [];
    let seed = 1;
    const point = (
      label: string,
      base: number[],
      cand: number[],
      r: (j: number) => number,
      lose?: (j: number) => number,
    ): void => {
      const truth = cand.reduce((a, p, i) => a + p - (base[i] as number), 0) / base.length;
      results.push(
        coverage(
          label,
          seed++,
          REPS,
          (rng) => lowerOf(draw(rng, base, cand, r, lose)) <= truth + 1e-12,
        ),
      );
    };
    // Few cases: exact coverage by enumeration, no Monte Carlo error.
    for (const k of [3, 4, 5]) {
      for (const rr of [2, 3]) {
        for (const p of [0.5, 0.7, 0.9]) {
          for (const shift of [0, -0.1, -0.2]) {
            results.push({
              label: `k=${k} r=${rr} p=${p} shift=${shift} (exact)`,
              reps: Number.POSITIVE_INFINITY,
              coverage: exactCoverage(k, rr, p, p + shift, LEVEL),
              mcse: 0,
            });
          }
        }
      }
    }
    for (const k of [17, 60]) {
      for (const rr of [2, 3, 5]) {
        for (const scenario of ["0.7", "0.9", "0.97", "mixture", "low"]) {
          for (const shift of [0, -0.05]) {
            const base = rates(k, scenario);
            point(
              `k=${k} r=${rr} ${scenario} shift=${shift}`,
              base,
              base.map((p) => Math.min(1, Math.max(0, p + shift))),
              () => rr,
            );
          }
        }
      }
    }
    // Heterogeneous effects with mean −0.05.
    const het = rates(40, "0.8");
    point(
      "k=40 r=2 heterogeneous",
      het,
      het.map((p, i) => Math.min(1, Math.max(0, p + (i % 2 === 0 ? 0.1 : -0.2)))),
      () => 2,
    );
    // Unequal replicates and missingness tied to the drop: degraded cases lose candidate trials.
    const base = rates(60, "0.95");
    const cand = base.map((p, i) => (i < 6 ? p - 0.6 : p));
    point(
      "k=60 r=3 informative missingness (6 cases lose 2)",
      base,
      cand,
      () => 3,
      (j) => (j < 6 ? 1 : 0),
    );
    point(
      "k=60 r=2..5 unequal replicates",
      base,
      base.map((p) => p - 0.05),
      (j) => 2 + (j % 4),
    );
    const verdict = judge(results, LEVEL, "fixed-cases lower bound");
    expect(verdict.failures).toEqual([]);
  });
});

describe("fixed-cases: exact stratified conditional regression test", () => {
  it("keeps the type-I error at or below 5% when nothing changed", () => {
    const results: PointResult[] = [];
    let seed = 1000;
    for (const k of [5, 17, 60]) {
      for (const r of [2, 3]) {
        for (const scenario of ["0.7", "0.9", "mixture", "low"]) {
          const base = rates(k, scenario);
          results.push(
            coverage(
              `k=${k} r=${r} ${scenario}`,
              seed++,
              REPS,
              (rng) =>
                exactStratifiedTest(
                  draw(rng, base, base, () => r),
                  "less",
                ).p > 0.05,
            ),
          );
        }
      }
    }
    expect(judge(results, LEVEL, "regression test, 1 − type-I").failures).toEqual([]);
  });
});

describe("the coverage check detects a biased interval (REQ-111)", () => {
  it("fails a lower bound shifted up by 2 points", () => {
    const base = rates(60, "0.9");
    const shifted = (strata: Stratum[]): Interval => {
      const i = scoreDifferenceInterval(strata, LEVEL, "lower");
      return { ...i, lower: i.lower + 0.02 };
    };
    const result = coverage(
      "biased",
      9001,
      REPS,
      (rng) => shifted(draw(rng, base, base, () => 2)).lower <= 0,
    );
    expect(judge([result], LEVEL, "biased bound (must fail)").failures.length).toBeGreaterThan(0);
  });

  it("fails the variant without the N/(N−1) factor at 2 replicates", () => {
    const base = rates(30, "mixture");
    const result = coverage(
      "mee k=30 r=2",
      9002,
      REPS,
      (rng) =>
        scoreDifferenceInterval(
          draw(rng, base, base, () => 2),
          LEVEL,
          "lower",
          { biasCorrection: false },
        ).lower <= 0,
    );
    expect(
      judge([result], LEVEL, "variant without the factor (must fail)").failures.length,
    ).toBeGreaterThan(0);
  });
});
