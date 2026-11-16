// REQ-50, REQ-111: the within-case permutation test on scores (R-P) matches two independent
// implementations on every committed table: R's coin (scripts/reference-score-permutation.R) and an
// exact enumeration in Python (scripts/score_permutation_oracle.py), both test-only oracles. The
// limits of the exact path and the rerun near a level are pinned at their edges.
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
import * as core from "../src/score-permutation-core.ts";
import {
  exactPathIgnoringWork,
  exactWork,
  rerunSeed,
  SCORE_PERMUTATION_WORK_LIMIT,
  scorePermutationCore,
} from "../src/score-permutation-core.ts";

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
      const result = scorePermutationTest(scores(table), { seed: 1 + i });
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
    const first = scorePermutationTest(offLattice, { seed: 5 });
    expect(first.method).toBe("within-case-permutation-monte-carlo");
    expect(first.resamples).toBe(SCORE_PERMUTATION_RESAMPLES);
    expect(first.seed).toBe(5);
    expect(scorePermutationTest(offLattice, { seed: 5 })).toEqual(first);
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
    expect(scorePermutationTest(wide, { seed: 3 }).method).toBe(
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
    const far = scorePermutationTest(offLattice, { seed: 5, levels: [0.0001] });
    expect(far.resamples).toBe(SCORE_PERMUTATION_RESAMPLES);
    const plain = scorePermutationTest(offLattice, { seed: 5 });
    const se = plain.monteCarloSE as number;
    // 2.9 standard errors away is near; 3.1 is not.
    expect(
      scorePermutationTest(offLattice, { seed: 5, levels: [plain.p + 3.1 * se] }).resamples,
    ).toBe(SCORE_PERMUTATION_RESAMPLES);
    const near = scorePermutationTest(offLattice, {
      seed: 5,
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
    const exported = new Set<unknown>(Object.values(stats));
    for (const [name, value] of Object.entries(core))
      if (typeof value === "function")
        expect(exported.has(value), `${name} is internal`).toBe(name === "scorePermutationTest");
    expect(Object.keys(stats).filter((n) => /^score_?permutation/i.test(n))).toEqual([
      "SCORE_PERMUTATION_RESAMPLES",
      "SCORE_PERMUTATION_RESAMPLES_NEAR_LEVEL",
      "SCORE_PERMUTATION_WORK_LIMIT",
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
    expect(scorePermutationTest(off, { seed: 5, resamples: 9 } as never).resamples).toBe(
      SCORE_PERMUTATION_RESAMPLES,
    );
  });
});

/** Two cases whose first value is `v`; the others lie on the lattice of step 1/10. */
const off = (v: number): CaseScores[] => [
  { id: "a", candidate: [v, 0.2], base: [0.7, 0.9] },
  { id: "b", candidate: [0.1, 0.4], base: [0.6, 0.8] },
];
/** n values on the 1–5 rating lattice. */
const levels = (n: number): number[] => Array.from({ length: n }, (_, i) => (i % 5) / 4);
/** k identical cases of 3-decimal scores, so the work estimate grows with every case. */
const identical = (k: number): CaseScores[] =>
  Array.from({ length: k }, (_, i) => ({
    id: `c${i}`,
    candidate: [0.101, 0.517, 0.733],
    base: [0.211, 0.389, 0.947],
  }));
const meanOf = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("score permutation test: the limits of the exact path, at their edges", () => {
  it("finds the lattice up to D = 1,000, and not beyond", () => {
    const at1000 = scorePermutationTest(off(0.123), { seed: 3 });
    expect(at1000.method).toBe("within-case-permutation-exact");
    expect(at1000.p).toBeCloseTo(exactByEnumeration(off(0.123)), 14);
    expect(scorePermutationTest(off(1 / 1001), { seed: 3 }).method).toBe(
      "within-case-permutation-monte-carlo",
    );
  });

  it("snaps a value onto the lattice only within 1e-9 of a lattice point", () => {
    // 5e-10 off a multiple of 1/1000 is 5e-7 off in lattice units: not on any lattice.
    expect(scorePermutationTest(off(0.123 + 5e-10), { seed: 3 }).method).toBe(
      "within-case-permutation-monte-carlo",
    );
  });

  it("rounds values to the nearest lattice point, where floating products fall just below", () => {
    // 0.57 · 100, 0.58 · 100 and 0.29 · 100 are each a little below the integer.
    const table: CaseScores[] = [
      { id: "a", candidate: [0.57, 0.29], base: [0.58, 0.9] },
      { id: "b", candidate: [0.29, 0.57], base: [0.58, 0.58] },
      { id: "c", candidate: [0.58, 0.01], base: [0.57, 0.29] },
    ];
    expect(scorePermutationTest(table).p).toBeCloseTo(exactByEnumeration(table), 14);
  });

  it("enumerates a case with 100,000 labellings and not one with 100,001", () => {
    const at = [{ id: "a", candidate: [0.25], base: levels(99_999) }];
    expect(scorePermutationTest(at).method).toBe("within-case-permutation-exact");
    const past = [{ id: "a", candidate: [0.25], base: levels(100_000) }];
    expect(scorePermutationTest(past, { seed: 3 }).method).toBe(
      "within-case-permutation-monte-carlo",
    );
  });

  it("enumerates up to the work limit, records W, and runs Monte Carlo past it", () => {
    // Identical cases of 3-decimal scores: W grows with every case, so k* is the last k under it.
    let k = 1;
    while ((exactWork(identical(k + 1)) as number) <= SCORE_PERMUTATION_WORK_LIMIT) k++;
    const under = scorePermutationTest(identical(k));
    expect(under.method).toBe("within-case-permutation-exact");
    expect(under.work).toBe(exactWork(identical(k)));
    const over = scorePermutationTest(identical(k + 1), { seed: 3 });
    expect(over.method).toBe("within-case-permutation-monte-carlo");
    expect(over.work).toBeGreaterThan(SCORE_PERMUTATION_WORK_LIMIT);
    // The last case adds less than a tenth of the limit, so a limit 10% off moves the edge.
    expect((over.work as number) / SCORE_PERMUTATION_WORK_LIMIT).toBeLessThan(1.1);
    expect((under.work as number) / SCORE_PERMUTATION_WORK_LIMIT).toBeGreaterThan(0.9);
  }, 60_000);

  it("estimates the same work whatever the order of cases or trials", () => {
    const t = tables.find((x) => x.id === "rating-mixed-k12-shift-1") as Table;
    const forward = exactWork(scores(t));
    const reversed = scores(t)
      .toReversed()
      .map((c) => ({ ...c, candidate: c.candidate.toReversed(), base: c.base.toReversed() }));
    expect(exactWork(reversed)).toBe(forward);
  });

  it("costs little when one arm is large: the dynamic programme picks the smaller arm", () => {
    const big: CaseScores[] = [
      { id: "a", candidate: Array.from({ length: 400 }, (_, i) => i / 1000), base: [0.2] },
    ];
    const start = performance.now();
    expect(exactPathIgnoringWork(big)?.p).toBeCloseTo(
      // T is at most observed when the base draws a value at least 0.2: 200 of them, and 0.2 itself.
      (1 + big[0]!.candidate.filter((v) => v >= 0.2).length) / 401,
      12,
    );
    expect(performance.now() - start).toBeLessThan(5_000);
  });
});

describe("score permutation test: the rerun near a level", () => {
  const offLattice = units(1_000_000, [
    { candidate: [123_457, 654_321], base: [500_001, 700_003] },
    { candidate: [222_223, 311_111], base: [400_007, 300_001] },
    { candidate: [900_001, 100_003], base: [800_011, 700_001] },
  ]);

  it("reruns with the seed (seed + 1,000,003) mod (2^32 − 1), and 1 for 0", () => {
    expect(rerunSeed(5)).toBe(1_000_008);
    expect(rerunSeed(4_294_967_295)).toBe(1_000_003);
    expect(rerunSeed(4_293_967_293)).toBe(1);
    expect(rerunSeed(4_293_967_292)).toBe(1);
    expect(rerunSeed(4_293_967_291)).toBe(4_294_967_294);
  });

  it("reports the rerun's p-value, which a fresh run at the rerun's seed reproduces", () => {
    const plain = scorePermutationTest(offLattice, { seed: 5 });
    const near = scorePermutationTest(offLattice, {
      seed: 5,
      levels: [plain.p - 2 * (plain.monteCarloSE as number)],
    });
    expect(near.seed).toBe(1_000_008);
    expect(near.resamples).toBe(100_000);
    const fresh = scorePermutationCore(offLattice, {
      rng: createRng(1_000_008),
      resamples: 100_000,
      exact: false,
    });
    expect(near.p).toBe(fresh.p);
    expect(near.p).not.toBe(plain.p);
  });

  it("records a seed that reproduces the p-value", () => {
    const once = scorePermutationTest(offLattice, { seed: 9 });
    expect(scorePermutationTest(offLattice, { seed: once.seed as number })).toEqual(once);
  });
});

/** The exact p by enumerating every labelling, in floating point: for small tables only. */
function exactByEnumeration(table: readonly CaseScores[]): number {
  const options = table.map((c) => {
    const pooled = [...c.candidate, ...c.base];
    const n = c.candidate.length;
    const out: number[] = [];
    const pick = (start: number, chosen: number[]): void => {
      if (chosen.length === n) {
        const cand = chosen.reduce((a, i) => a + (pooled[i] as number), 0);
        const all = pooled.reduce((a, b) => a + b, 0);
        out.push(cand / n - (all - cand) / c.base.length);
        return;
      }
      for (let i = start; i < pooled.length; i++) pick(i + 1, [...chosen, i]);
    };
    pick(0, []);
    return out;
  });
  const observed = table.reduce((a, c) => a + meanOf(c.candidate) - meanOf(c.base), 0);
  let hits = 0;
  let total = 0;
  const walk = (i: number, acc: number): void => {
    if (i === options.length) {
      total++;
      if (acc <= observed + 1e-9) hits++;
      return;
    }
    for (const d of options[i] as number[]) walk(i + 1, acc + d);
  };
  walk(0, 0);
  return hits / total;
}
