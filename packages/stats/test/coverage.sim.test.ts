// Simulation studies of the methods the decision rule uses for fixed-cases (REQ-50, REQ-58,
// REQ-111). The sampled-cases methods and the Wilson interval have their own studies in scripts/
// and their measured coverage in VALIDATION.md; they are not yet validated to this bar. Each grid
// point runs REPS repetitions (2,000 per pull request, 10,000 nightly) with its own seed. A point
// fails when coverage falls below nominal by more than 3 Monte Carlo standard errors; the grid
// mean fails when it falls below nominal by more than 3 standard errors of the mean.
import { describe, expect, it } from "vitest";

import {
  exactStratifiedTest,
  scoreDifferenceInterval,
  type Interval,
  type Rng,
  type Stratum,
} from "../src/index.ts";
import { binomial, coverage, judge, type PointResult, REPS } from "./support/simulate.ts";

const LEVEL = 0.95;

function fixedCasesStrata(
  rng: Rng,
  base: readonly number[],
  candidate: readonly number[],
  r: number,
): Stratum[] {
  return base.map((p, j) => ({
    candidate: { successes: binomial(rng, r, candidate[j] as number), trials: r },
    base: { successes: binomial(rng, r, p), trials: r },
  }));
}

function rates(k: number, scenario: string): number[] {
  if (scenario === "mixture")
    return Array.from({ length: k }, (_, i) =>
      i < Math.round(0.7 * k) ? 1 : i < Math.round(0.9 * k) ? 0.8 : 0.3,
    );
  return Array.from({ length: k }, () => Number(scenario));
}

describe("fixed-cases: stratified Miettinen–Nurminen one-sided lower bound", () => {
  const results: PointResult[] = [];
  let seed = 1;
  for (const k of [17, 60]) {
    for (const r of [2, 3]) {
      for (const scenario of ["0.7", "0.9", "1", "mixture"]) {
        for (const shift of [0, -0.05, -0.1]) {
          const base = rates(k, scenario);
          const cand = base.map((p) => Math.min(1, Math.max(0, p + shift)));
          const truth = cand.reduce((a, p, i) => a + p - (base[i] as number), 0) / k;
          const s = seed++;
          results.push(
            coverage(
              `k=${k} r=${r} ${scenario} shift=${shift}`,
              s,
              REPS,
              (rng) =>
                scoreDifferenceInterval(fixedCasesStrata(rng, base, cand, r), LEVEL, "lower")
                  .lower <=
                truth + 1e-12,
            ),
          );
        }
      }
    }
  }
  it(`holds ${LEVEL} coverage on every grid point (${REPS} repetitions each)`, () => {
    const verdict = judge(results, LEVEL);
    expect(verdict.failures).toEqual([]);
  });
});

describe("fixed-cases: exact stratified conditional regression test", () => {
  it("keeps the type-I error at or below 5% when nothing changed", () => {
    const results: PointResult[] = [];
    let seed = 1000;
    for (const k of [17, 60]) {
      for (const r of [2, 3]) {
        for (const scenario of ["0.7", "0.9", "mixture"]) {
          const base = rates(k, scenario);
          results.push(
            coverage(
              `k=${k} r=${r} ${scenario}`,
              seed++,
              REPS,
              (rng) => exactStratifiedTest(fixedCasesStrata(rng, base, base, r), "less").p > 0.05,
            ),
          );
        }
      }
    }
    expect(judge(results, LEVEL).failures).toEqual([]);
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
      9,
      REPS,
      (rng) => shifted(fixedCasesStrata(rng, base, base, 2)).lower <= 0,
    );
    expect(judge([result], LEVEL).failures.length).toBeGreaterThan(0);
  });

  it("fails a Wald interval at a small sample", () => {
    const result = coverage("wald n=20 p=0.95", 10, REPS, (rng) => {
      const x = binomial(rng, 20, 0.95);
      const p = x / 20;
      const half = 1.959964 * Math.sqrt((p * (1 - p)) / 20);
      return p - half <= 0.95 && 0.95 <= p + half;
    });
    expect(judge([result], LEVEL).failures.length).toBeGreaterThan(0);
  });
});
