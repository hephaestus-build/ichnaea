// REQ-50, REQ-111: the within-case permutation test on scores (R-P) matches two independent
// implementations on every committed table: R's coin (scripts/reference-score-permutation.R) and an
// exact enumeration in Python (scripts/reference-score-permutation.py), both test-only oracles.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type CaseScores,
  createRng,
  SCORE_PERMUTATION_RESAMPLES,
  SCORE_PERMUTATION_RESAMPLES_NEAR_LEVEL,
  scorePermutationTest,
} from "../src/index.ts";
import * as stats from "../src/index.ts";
import { scorePermutationCore } from "../src/score-permutation-core.ts";

interface Table {
  id: string;
  denominator: number;
  cases: { candidate: number[]; base: number[] }[];
}
const read = <T>(name: string): T =>
  JSON.parse(readFileSync(join(import.meta.dirname, name), "utf8")) as T;
const { tables } = read<{ tables: Table[] }>("reference-score-permutation-tables.json");
const coin = read<{ results: { id: string; p: number; method: string; resamples?: number }[] }>(
  "reference-coin-score-permutation.json",
);
const python = read<{ results: { id: string; p: number; method: string }[] }>(
  "reference-python-score-permutation.json",
);

const scores = (t: Table): CaseScores[] =>
  t.cases.map((c, i) => ({
    id: `c${i}`,
    candidate: c.candidate.map((u) => u / t.denominator),
    base: c.base.map((u) => u / t.denominator),
  }));
const units = (d: number, cases: Table["cases"]): CaseScores[] =>
  scores({ id: "", denominator: d, cases });

describe("score permutation test: reference values", () => {
  it("has at least 200 tables, each with a result from both oracles", () => {
    expect(tables.length).toBeGreaterThanOrEqual(200);
    expect(coin.results.map((r) => r.id)).toEqual(tables.map((t) => t.id));
    expect(python.results.map((r) => r.id)).toEqual(tables.map((t) => t.id));
  });

  it.each(tables.map((t, i) => [t.id, i] as const))(
    "%s matches coin and the Python enumeration",
    (_, i) => {
      const table = tables[i] as Table;
      const fromCoin = coin.results[i] as (typeof coin.results)[number];
      const fromPython = python.results[i] as (typeof python.results)[number];
      const result = scorePermutationTest(scores(table), { rng: createRng(1 + i) });
      if (result.method === "within-case-permutation-exact") {
        // Both enumerate: agreement to rounding.
        expect(Math.abs(result.p - fromPython.p)).toBeLessThanOrEqual(1e-12);
        if (fromCoin.method === "exact" || fromCoin.method === "constant")
          expect(Math.abs(result.p - fromCoin.p)).toBeLessThanOrEqual(1e-9);
      } else {
        // Monte Carlo: within 4 standard errors of the exact value.
        expect(fromPython.method).not.toBe("skipped");
        expect(Math.abs(result.p - fromPython.p)).toBeLessThanOrEqual(
          4 * (result.monteCarloSE as number) + 1e-12,
        );
      }
      if (fromCoin.method === "approximate") {
        const resamples = fromCoin.resamples as number;
        const se = Math.sqrt((fromPython.p * (1 - fromPython.p)) / resamples);
        expect(Math.abs(fromCoin.p - fromPython.p)).toBeLessThanOrEqual(4 * se + 1e-12);
      }
    },
  );

  it("enumerates exactly on every lattice table the oracles enumerate", () => {
    const lattice = tables.filter((t) => t.denominator <= 1000);
    for (const t of lattice)
      expect(scorePermutationTest(scores(t)).method, t.id).toBe("within-case-permutation-exact");
  });
});

describe("score permutation test: definition", () => {
  it("gives 5/6 for one case of two trials whose labels can only move the mean by ±1", () => {
    const { p, statistic } = scorePermutationTest(units(1, [{ candidate: [1, 0], base: [0, 1] }]));
    expect(statistic).toBe(0);
    expect(p).toBeCloseTo(5 / 6, 15);
  });

  it("gives 204/216 for three cases of 1–5 ratings, as coin's exact test does", () => {
    const table = units(4, [
      { candidate: [4, 3], base: [2, 3] },
      { candidate: [4, 4], base: [1, 2] },
      { candidate: [2, 3], base: [3, 4] },
    ]);
    const { p, statistic } = scorePermutationTest(table);
    expect(statistic).toBeCloseTo(0.625 / 3, 15);
    expect(p).toBeCloseTo(204 / 216, 15);
  });

  it("reports the equal-weight mean of per-case differences, whatever the trial counts", () => {
    const table = units(5, [
      { candidate: [1], base: [2, 3, 5] },
      { candidate: [4, 3, 3], base: [2, 5] },
    ]);
    const expected = (0.2 - 10 / 15 + (10 / 15 - 0.7)) / 2;
    expect(scorePermutationTest(table).statistic).toBeCloseTo(expected, 15);
  });

  it("does not depend on the order of cases or of trials within an arm", () => {
    const t = tables.find((x) => x.id === "rating-mixed-k8-shift-1") as Table;
    const forward = scorePermutationTest(scores(t));
    const reversed = scores(t)
      .toReversed()
      .map((c) => ({ ...c, candidate: c.candidate.toReversed(), base: c.base.toReversed() }));
    const back = scorePermutationTest(reversed);
    expect(back.p).toBeCloseTo(forward.p, 14);
    expect(back.statistic).toBeCloseTo(forward.statistic, 14);
  });

  it("lets a case whose values are all equal move the estimate but not the p-value", () => {
    const table = units(4, [
      { candidate: [4, 3], base: [2, 3] },
      { candidate: [2, 3], base: [3, 4] },
    ]);
    const withConstant = [...table, ...units(4, [{ candidate: [0, 0], base: [0, 0] }])];
    expect(scorePermutationTest(withConstant).p).toBeCloseTo(scorePermutationTest(table).p, 15);
    expect(scorePermutationTest(withConstant).statistic).toBeCloseTo(
      (scorePermutationTest(table).statistic * 2) / 3,
      15,
    );
  });

  it("leaves out a case without a completed trial in an arm", () => {
    const table = units(4, [
      { candidate: [4, 3], base: [2, 3] },
      { candidate: [4, 4], base: [1, 2] },
    ]);
    const withMissing = [...table, { id: "gone", candidate: [], base: [0.5] }];
    expect(scorePermutationTest(withMissing)).toEqual(scorePermutationTest(table));
    expect(scorePermutationTest(withMissing).statistic).toBeCloseTo((0.25 + 0.625) / 2, 15);
  });

  it("is 1 when every case is constant, and counts ties as at most the observed statistic", () => {
    const flat = units(4, [
      { candidate: [2, 2], base: [2, 2] },
      { candidate: [4], base: [4, 4] },
    ]);
    expect(scorePermutationTest(flat).p).toBe(1);
    // One case, candidate [1, 1] against base [0, 0]: only the observed labelling has T ≤ 1.
    expect(scorePermutationTest(units(1, [{ candidate: [0, 0], base: [1, 1] }])).p).toBeCloseTo(
      1 / 6,
      15,
    );
  });

  it.each([Number.NaN, -0.01, 1.01, Number.POSITIVE_INFINITY])("refuses the value %s", (v) => {
    expect(() =>
      scorePermutationTest([{ id: "a", candidate: [v, 0.5], base: [0.5, 0.5] }]),
    ).toThrow(RangeError);
  });

  it("refuses a table where no case has a completed trial in both arms", () => {
    expect(() => scorePermutationTest([{ id: "a", candidate: [], base: [0.5] }])).toThrow(
      RangeError,
    );
  });
});

describe("score permutation test: the exact and the Monte Carlo path", () => {
  const offLattice = units(1_000_000, [
    { candidate: [123_457, 654_321], base: [500_001, 700_003] },
    { candidate: [222_223, 311_111], base: [400_007, 300_001] },
    { candidate: [900_001, 100_003], base: [800_011, 700_001] },
  ]);

  it("runs Monte Carlo off the lattice, needs a seeded generator there, and is reproducible", () => {
    expect(() => scorePermutationTest(offLattice)).toThrow(RangeError);
    const first = scorePermutationTest(offLattice, { rng: createRng(5) });
    expect(first.method).toBe("within-case-permutation-monte-carlo");
    expect(first.resamples).toBe(SCORE_PERMUTATION_RESAMPLES);
    expect(first.seed).toBe(5);
    expect(scorePermutationTest(offLattice, { rng: createRng(5) })).toEqual(first);
    // p = (1 + count) / (1 + B): a multiple of 1/(1 + B), never 0.
    const count = first.p * (1 + SCORE_PERMUTATION_RESAMPLES);
    expect(Math.abs(count - Math.round(count))).toBeLessThan(1e-6);
    // Every case drops as far as its values allow, so only the observed labelling (1 in 6^6) has
    // T at most T observed, and 9 resamples find none: p = 1/10.
    const floor = units(
      1_000_000,
      Array.from({ length: 6 }, (_, i) => ({
        candidate: [100_001 + i, 200_003 + i],
        base: [900_001 + i, 800_003 + i],
      })),
    );
    expect(scorePermutationCore(floor, { rng: createRng(5), resamples: 9 }).p).toBe(0.1);
  });

  it("runs Monte Carlo when one case has more than 100,000 labellings", () => {
    // 10 trials in each arm: C(20, 10) = 184,756 labellings.
    const wide = units(4, [
      { candidate: [4, 4, 3, 3, 2, 4, 4, 3, 4, 4], base: [4, 3, 4, 4, 4, 4, 3, 4, 4, 4] },
    ]);
    expect(scorePermutationTest(wide, { rng: createRng(3) }).method).toBe(
      "within-case-permutation-monte-carlo",
    );
    const narrow = units(4, [
      { candidate: [4, 4, 3, 3, 2, 4, 4, 3, 4], base: [4, 3, 4, 4, 4, 4, 3, 4, 4] },
    ]);
    expect(scorePermutationTest(narrow).method).toBe("within-case-permutation-exact");
  });

  it("enumerates 146 cases of 1–5 ratings with 3 trials", () => {
    const t = tables.find((x) => x.id === "rating-large-k146-r3-shift0") as Table;
    expect(scorePermutationTest(scores(t)).method).toBe("within-case-permutation-exact");
  });

  it("computes a p-value near a level again with 100,000 resamples and a new seed", () => {
    const far = scorePermutationTest(offLattice, { rng: createRng(5), levels: [0.0001] });
    expect(far.resamples).toBe(SCORE_PERMUTATION_RESAMPLES);
    const plain = scorePermutationTest(offLattice, { rng: createRng(5) });
    const se = plain.monteCarloSE as number;
    // 2.9 standard errors away is near; 3.1 is not.
    expect(
      scorePermutationTest(offLattice, { rng: createRng(5), levels: [plain.p + 3.1 * se] })
        .resamples,
    ).toBe(SCORE_PERMUTATION_RESAMPLES);
    const near = scorePermutationTest(offLattice, {
      rng: createRng(5),
      levels: [0.0001, plain.p - 2.9 * se],
    });
    expect(near.resamples).toBe(SCORE_PERMUTATION_RESAMPLES_NEAR_LEVEL);
    expect(near.seed).not.toBe(5);
    expect(near.monteCarloSE as number).toBeLessThan(plain.monteCarloSE as number);
    expect(near.statistic).toBe(plain.statistic);
  });
});

describe("score permutation test: the public entry point", () => {
  it("exports the test and its fixed resample counts, never the internal entry point", () => {
    expect(Object.keys(stats).filter((n) => /^score_?permutation/i.test(n))).toEqual([
      "SCORE_PERMUTATION_RESAMPLES",
      "SCORE_PERMUTATION_RESAMPLES_NEAR_LEVEL",
      "scorePermutationTest",
    ]);
  });

  it("has no switch for the resample count or for Monte Carlo", () => {
    const table = units(4, [
      { candidate: [4, 3], base: [2, 3] },
      { candidate: [4, 4], base: [1, 2] },
    ]);
    // Settings that only the internal entry point reads are ignored here.
    const settings = { rng: createRng(5), resamples: 9, exact: false } as Parameters<
      typeof scorePermutationTest
    >[1];
    expect(scorePermutationTest(table, settings).method).toBe("within-case-permutation-exact");
    const off = units(1_000_000, [
      { candidate: [123_457, 654_321], base: [500_001, 700_003] },
      { candidate: [222_223, 311_111], base: [400_007, 300_001] },
    ]);
    expect(scorePermutationTest(off, { rng: createRng(5), resamples: 9 } as never).resamples).toBe(
      SCORE_PERMUTATION_RESAMPLES,
    );
  });
});
