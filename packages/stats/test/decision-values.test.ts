// Pins the values a decision reads (the stats review's surviving mutants): non-inferiority and
// regression p-values against R (ratesci's score test, the exact Mantel–Haenszel test), the level,
// the tails, the default variance factor, floors, the MDE quantile and the generator's output.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  type CaseCounts,
  compareCounts,
  createRng,
  EstimandError,
  exactStratifiedTest,
  fixedCasesFloor,
  fixedCasesMde,
  qnorm,
  restrictedMle,
  scoreDifferenceInterval,
  scoreDifferenceTest,
  tangoInterval,
  tangoTest,
} from "../src/index.ts";

const reference = JSON.parse(
  readFileSync(join(import.meta.dirname, "reference-ratesci.json"), "utf8"),
) as {
  pvalues: Array<{
    x1: number[];
    n1: number[];
    x2: number[];
    n2: number[];
    margin: number;
    nonInferiorityP: number;
    lower90: number;
    regressionP: number;
  }>;
  tangoAll: Array<{
    n: number;
    candidateOnly: number;
    baseOnly: number;
    skew: boolean;
    lower: number;
    upper: number;
  }>;
};

const toCases = (r: { x1: number[]; n1: number[]; x2: number[]; n2: number[] }): CaseCounts[] =>
  r.x1.map((x1, i) => ({
    id: `c${String(i).padStart(3, "0")}`,
    candidate: { successes: x1, trials: r.n1[i] as number },
    base: {
      successes: r.x2[i] as number,
      trials: r.n2[i] as number,
    },
  }));

const one = (base: number, candidate: number, i: number): CaseCounts => ({
  id: `c${String(i).padStart(3, "0")}`,
  base: { successes: base, trials: 1 },
  candidate: { successes: candidate, trials: 1 },
});

describe("decision values against R", () => {
  it.each(
    reference.pvalues.map((r, i) => [`set ${Math.floor(i / 4)} margin ${r.margin}`, r] as const),
  )("%s", (_, r) => {
    const result = compareCounts({
      estimand: "fixed-cases",
      cases: toCases(r),
      alpha: 0.05,
      margin: r.margin,
    });
    expect(Math.abs(result.nonInferiorityP - r.nonInferiorityP)).toBeLessThan(1e-6);
    expect(Math.abs(result.regressionP - r.regressionP)).toBeLessThan(1e-9);
    // The one-sided 95% bound is the lower end of R's two-sided 90% interval: the level is 1 − α.
    expect(Math.abs(result.difference.lower - r.lower90)).toBeLessThan(1e-6);
    expect(result.difference.level).toBe(0.95);
  });

  it("non-inferiority p ≤ α exactly when the bound lies above −margin", () => {
    const counts = fc.integer({ min: 2, max: 4 }).chain((n) =>
      fc.record({
        n: fc.constant(n),
        a: fc.integer({ min: 0, max: n }),
        b: fc.integer({ min: 0, max: n }),
      }),
    );
    fc.assert(
      fc.property(
        fc.array(counts, { minLength: 3, maxLength: 12 }),
        fc.double({ min: 0, max: 0.4, noNaN: true }),
        (strata, margin) => {
          const cases = strata.map(({ n, a, b }, i) => ({
            id: `c${i}`,
            candidate: { successes: a, trials: n },
            base: { successes: b, trials: n },
          }));
          const r = compareCounts({
            estimand: "fixed-cases",
            cases,
            alpha: 0.05,
            margin,
            rng: createRng(5),
          });
          const gap = r.difference.lower + margin;
          if (Math.abs(gap) > 1e-9) expect(r.nonInferiorityP <= 0.05).toBe(gap > 0);
        },
      ),
      { seed: 20261115, numRuns: 300 },
    );
  }, 60_000);

  it("the regression test looks for a drop, not a gain", () => {
    const drop = toCases({
      x1: [0, 0, 0, 0],
      n1: [2, 2, 2, 2],
      x2: [2, 2, 2, 2],
      n2: [2, 2, 2, 2],
    });
    const gain = toCases({
      x1: [2, 2, 2, 2],
      n1: [2, 2, 2, 2],
      x2: [0, 0, 0, 0],
      n2: [2, 2, 2, 2],
    });
    expect(
      compareCounts({ estimand: "fixed-cases", cases: drop, alpha: 0.05, margin: 0.1 }).regressionP,
    ).toBeLessThan(0.01);
    expect(
      compareCounts({ estimand: "fixed-cases", cases: gain, alpha: 0.05, margin: 0.1 }).regressionP,
    ).toBe(1);
  });

  it("the score test's tails are the right way round", () => {
    const strata = [
      { candidate: { successes: 9, trials: 10 }, base: { successes: 5, trials: 10 } },
    ];
    expect(scoreDifferenceTest(strata, 0, "greater").p).toBeLessThan(0.05);
    expect(scoreDifferenceTest(strata, 0, "less").p).toBeGreaterThan(0.95);
    expect(
      scoreDifferenceTest(strata, 0, "greater").p + scoreDifferenceTest(strata, 0, "less").p,
    ).toBeCloseTo(1, 12);
  });

  it("Tango's regression test looks for a drop", () => {
    const table = { both: 250, candidateOnly: 5, baseOnly: 40, neither: 5 };
    expect(tangoTest(table, 0, "less", true).p).toBeLessThan(0.01);
    expect(tangoTest(table, 0, "greater", true).p).toBeGreaterThan(0.99);
  });

  it("compareCounts' sampled-cases regression test (Tango, 300+ cases) looks for a drop", () => {
    const drop = Array.from({ length: 300 }, (_, i) => (i < 40 ? one(1, 0, i) : one(1, 1, i)));
    const gain = Array.from({ length: 300 }, (_, i) => (i < 40 ? one(0, 1, i) : one(1, 1, i)));
    expect(
      compareCounts({ estimand: "sampled-cases", cases: drop, alpha: 0.05, margin: 0.05 })
        .regressionP,
    ).toBeLessThan(0.01);
    expect(
      compareCounts({ estimand: "sampled-cases", cases: gain, alpha: 0.05, margin: 0.05 })
        .regressionP,
    ).toBeGreaterThan(0.99);
  });

  it("p-values do not underflow for extreme statistics", () => {
    const strata = Array.from({ length: 200 }, () => ({
      candidate: { successes: 10, trials: 10 },
      base: { successes: 0, trials: 10 },
    }));
    expect(scoreDifferenceTest(strata, 0, "less").p).toBeGreaterThan(0);
  });
});

describe("Tango against R on every table with n of 10 and 25", () => {
  it.each(
    reference.tangoAll
      .filter((r) => !r.skew)
      .map((r) => [`n=${r.n} b=${r.candidateOnly} c=${r.baseOnly}`, r] as const),
  )("%s (plain)", (_, r) => {
    const i = tangoInterval(
      {
        both: r.n - r.candidateOnly - r.baseOnly,
        candidateOnly: r.candidateOnly,
        baseOnly: r.baseOnly,
        neither: 0,
      },
      0.9,
      "two",
      false,
    );
    expect(Math.abs(i.lower - r.lower)).toBeLessThan(1e-6);
    expect(Math.abs(i.upper - r.upper)).toBeLessThan(1e-6);
  });

  it("the skewness-corrected interval agrees on every table", () => {
    const mismatches = reference.tangoAll
      .filter((r) => r.skew)
      .filter((r) => {
        const i = tangoInterval(
          {
            both: r.n - r.candidateOnly - r.baseOnly,
            candidateOnly: r.candidateOnly,
            baseOnly: r.baseOnly,
            neither: 0,
          },
          0.9,
          "two",
          true,
        );
        return Math.abs(i.lower - r.lower) > 1e-6 || Math.abs(i.upper - r.upper) > 1e-6;
      })
      .map((r) => `n=${r.n} b=${r.candidateOnly} c=${r.baseOnly}`);
    expect(mismatches).toEqual([]);
  });

  it("swapping the arms negates the interval", () => {
    for (const r of reference.tangoAll.filter((x) => x.n === 25 && x.skew)) {
      const t = {
        both: r.n - r.candidateOnly - r.baseOnly,
        candidateOnly: r.candidateOnly,
        baseOnly: r.baseOnly,
        neither: 0,
      };
      const a = tangoInterval(t, 0.9, "two", true);
      const b = tangoInterval(
        { ...t, candidateOnly: t.baseOnly, baseOnly: t.candidateOnly },
        0.9,
        "two",
        true,
      );
      expect(Math.abs(a.lower + b.upper)).toBeLessThan(1e-9);
    }
  });
});

describe("defaults, floors and the MDE", () => {
  it("defaults to the N/(N−1) factor without skewness correction", () => {
    const strata = [
      { candidate: { successes: 1, trials: 2 }, base: { successes: 2, trials: 2 } },
      { candidate: { successes: 2, trials: 2 }, base: { successes: 2, trials: 2 } },
    ];
    const fallback = scoreDifferenceInterval(strata, 0.9);
    const explicit = scoreDifferenceInterval(strata, 0.9, "two", {
      biasCorrection: true,
      skewnessCorrection: false,
    });
    const without = scoreDifferenceInterval(strata, 0.9, "two", { biasCorrection: false });
    expect(fallback).toEqual(explicit);
    expect(fallback.lower).toBeLessThan(without.lower);
  });

  it.each([
    [17, 2],
    [17, 3],
    [60, 2],
    [60, 3],
  ])("the floor for %i cases at r = %i is z²/(K(r − ½) + z²) at α = 0.05", (k, r) => {
    const z2 = qnorm(0.95) ** 2;
    expect(Math.abs(fixedCasesFloor(k, r) - z2 / (k * (r - 0.5) + z2))).toBeLessThan(1e-6);
  });

  it("the MDE is the power quantile (nearest rank) of the simulated margins", () => {
    const rates = Array.from({ length: 15 }, (_, i) => 0.6 + 0.02 * i);
    const simulations = 37;
    const { mde } = fixedCasesMde({ rates, replicates: 2, simulations, rng: createRng(99) });
    // An independent replay of the same simulation with the same stream.
    const rng = createRng(99);
    const draw = (p: number): number => [0, 1].reduce((s) => s + (rng.uniform() < p ? 1 : 0), 0);
    const needed: number[] = [];
    for (let s = 0; s < simulations; s++) {
      const strata = rates.map((p) => ({
        candidate: { successes: draw(p), trials: 2 },
        base: { successes: draw(p), trials: 2 },
      }));
      needed.push(-scoreDifferenceInterval(strata, 0.95, "lower").lower);
    }
    needed.sort((a, b) => a - b);
    expect(mde).toBe(needed[Math.ceil(0.8 * simulations) - 1]);
  });
});

describe("generator", () => {
  it("returns numpy's res53 value for seed 42", () => {
    expect(createRng(42).uniform()).toBe(0.3745401188473625);
  });
});

const logTerm = (x: number, n: number, q: number): number =>
  (x > 0 ? x * Math.log(q) : 0) + (n - x > 0 ? (n - x) * Math.log(1 - q) : 0);

describe("exact test and restricted MLE properties", () => {
  const strataArb = fc.array(
    fc.integer({ min: 1, max: 4 }).chain((n) =>
      fc.record({
        candidate: fc.record({
          successes: fc.integer({ min: 0, max: n }),
          trials: fc.constant(n),
        }),
        base: fc.record({ successes: fc.integer({ min: 0, max: n }), trials: fc.constant(n) }),
      }),
    ),
    { minLength: 1, maxLength: 8 },
  );

  it("exact p-values lie in [0, 1] and the two tails cover the observed total", () => {
    fc.assert(
      fc.property(strataArb, (strata) => {
        const less = exactStratifiedTest(strata, "less").p;
        const greater = exactStratifiedTest(strata, "greater").p;
        expect(less).toBeGreaterThanOrEqual(0);
        expect(less).toBeLessThanOrEqual(1 + 1e-12);
        expect(less + greater).toBeGreaterThanOrEqual(1 - 1e-12);
      }),
      { seed: 20261115 },
    );
  });

  it("one more candidate failure never raises the exact p-value of a drop", () => {
    fc.assert(
      fc.property(strataArb, fc.nat(), (strata, pick) => {
        const i = pick % strata.length;
        const s = strata[i]!;
        if (s.candidate.successes === 0) return;
        const worse = strata.map((x, j) =>
          j === i
            ? { ...x, candidate: { ...x.candidate, successes: x.candidate.successes - 1 } }
            : x,
        );
        expect(exactStratifiedTest(worse, "less").p).toBeLessThanOrEqual(
          exactStratifiedTest(strata, "less").p + 1e-12,
        );
      }),
      { seed: 20261115 },
    );
  });

  it("the restricted MLE satisfies its constraint and maximises the likelihood", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 12 }),
        fc.nat(),
        fc.nat(),
        fc.double({ min: -0.95, max: 0.95, noNaN: true }),
        (n1, n2, a, b, delta) => {
          const x1 = a % (n1 + 1);
          const x2 = b % (n2 + 1);
          const { p1, p2 } = restrictedMle(x1, n1, x2, n2, delta);
          const ll = (q1: number, q2: number): number => {
            return logTerm(x1, n1, q1) + logTerm(x2, n2, q2);
          };
          if (p1 - p2 > delta + 1e-6 || p1 - p2 < delta - 1e-6) {
            // Clamped at the boundary of the parameter space.
            expect(p1 === 0 || p1 === 1 || p2 === 0 || p2 === 1).toBe(true);
            return;
          }
          const best = ll(p1, p2);
          for (let q = Math.max(0, delta) + 0.01; q < Math.min(1, 1 + delta) - 0.01; q += 0.01) {
            expect(ll(q, q - delta)).toBeLessThanOrEqual(best + 1e-6);
          }
        },
      ),
      { seed: 20261115, numRuns: 300 },
    );
  });
});

const at = (input: CaseCounts[]): ReturnType<typeof compareCounts> =>
  compareCounts({
    estimand: "fixed-cases",
    cases: input,
    alpha: 0.05,
    margin: 0.1,
    rng: createRng(1),
  });

describe("input validation", () => {
  const ok = {
    id: "a",
    base: { successes: 1, trials: 2 },
    candidate: { successes: 1, trials: 2 },
  };
  it.each([
    ["alpha 0.5", { alpha: 0.5, margin: 0.1, cases: [ok] }],
    ["a NaN margin", { alpha: 0.05, margin: Number.NaN, cases: [ok] }],
    ["a negative margin", { alpha: 0.05, margin: -0.1, cases: [ok] }],
    [
      "non-integer successes",
      {
        alpha: 0.05,
        margin: 0.1,
        cases: [{ ...ok, base: { successes: 0.5, trials: 2 } }],
      },
    ],
    ["duplicate case IDs", { alpha: 0.05, margin: 0.1, cases: [ok, ok] }],
  ])("refuses %s", (_, input) => {
    expect(() => compareCounts({ estimand: "fixed-cases", ...input })).toThrow(RangeError);
  });

  it("keeps a case with one completed trial in an arm, and excludes one with none (DC-6)", () => {
    const thin = {
      id: "b",
      base: { successes: 1, trials: 1 },
      candidate: { successes: 1, trials: 1 },
    };
    const empty = {
      id: "e",
      base: { successes: 1, trials: 2 },
      candidate: { successes: 0, trials: 0 },
    };
    const result = compareCounts({
      estimand: "fixed-cases",
      cases: [ok, { ...ok, id: "c" }, { ...ok, id: "d" }, thin, empty],
      alpha: 0.05,
      margin: 0.1,
      rng: createRng(1),
    });
    expect(result.usedCases).toBe(4);
    expect(result.excludedCases).toBe(1);
    expect(result.validated).toBe(false);
    expect(result.limitations).toContain(
      "1 case(s) have no completed trial in an arm and are excluded",
    );
    expect(() =>
      compareCounts({ estimand: "fixed-cases", cases: [empty], alpha: 0.05, margin: 0.1 }),
    ).toThrow(EstimandError);
  });

  it("a regression in a case's only remaining trial stays in the evidence (the DC-6 example)", () => {
    // 60 cases at 3 of 3 in both arms. In 6, two candidate trials are missing and the third fails.
    const full = { successes: 3, trials: 3 };
    const input: CaseCounts[] = Array.from({ length: 60 }, (_, i) => ({
      id: `c${String(i).padStart(2, "0")}`,
      base: full,
      candidate: i < 6 ? { successes: 0, trials: 1 } : full,
    }));
    const result = compareCounts({
      estimand: "fixed-cases",
      cases: input,
      alpha: 0.05,
      margin: 0.05,
      rng: createRng(1),
    });
    expect(result.difference.estimate).toBeCloseTo(-0.1, 12);
    expect(result.usedCases).toBe(60);
    expect(result.nonInferiorityP).toBeGreaterThan(0.05);
    expect(result.regressionP).toBeLessThan(0.001);
    expect(result.regressionMethod).toBe("within-case-permutation");
  });

  it("marks results outside the validated domain, naming each reason (DC-6)", () => {
    const five = ["a", "b", "c", "d", "e"].map((id) => ({ ...ok, id }));
    expect(at(five)).toMatchObject({ validated: true, limitations: [] });
    expect(at(five.slice(0, 4)).limitations).toEqual([
      "4 case(s); the validated domain starts at 5",
    ]);
    // Unequal binary trial counts are inside the grid.
    const unequal = [
      ...five,
      { id: "f", base: { successes: 2, trials: 3 }, candidate: { successes: 3, trials: 5 } },
    ];
    expect(at(unequal)).toMatchObject({
      validated: true,
      regressionMethod: "within-case-permutation",
    });
    const many = [
      ...five,
      { id: "f", base: { successes: 6, trials: 6 }, candidate: { successes: 6, trials: 6 } },
    ];
    expect(at(many).limitations).toEqual([
      "more than 5 trials per case and arm is outside the studied grid",
    ]);
    // 2 of 12 cells with one trial: below 90% with two or more.
    const thin = { successes: 1, trials: 1 };
    const sparse = [...five, { id: "f", base: thin, candidate: thin }];
    expect(at(sparse).limitations).toEqual([
      "fewer than 90% of case-arm cells have 2 or more completed trials",
    ]);
    // 1 of 10 cells with one trial: exactly 90%, inside.
    const edge = [...five.slice(0, 4), { id: "e", base: ok.base, candidate: thin }];
    expect(at(edge).validated).toBe(true);
  });
});

describe("the fixed-cases estimand with unequal replicates (equal case weights)", () => {
  it("estimates the mean of per-case differences", () => {
    // Case a: 8 base passes, 8 candidate fails. Case b: 2 base fails, 2 candidate passes. Mean 0.
    const cases: CaseCounts[] = [
      {
        id: "a",
        base: { successes: 8, trials: 8 },
        candidate: { successes: 0, trials: 8 },
      },
      {
        id: "b",
        base: { successes: 0, trials: 2 },
        candidate: { successes: 2, trials: 2 },
      },
    ];
    expect(
      compareCounts({ estimand: "fixed-cases", cases, alpha: 0.05, margin: 0.1, rng: createRng(1) })
        .difference.estimate,
    ).toBeCloseTo(0, 12);
  });
});
