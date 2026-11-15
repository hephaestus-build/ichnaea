// REQ-48, REQ-50, REQ-111: unit tests against hand-computed values, with stated tolerances.
import fc from "fast-check";
import mt19937 from "@stdlib/random-base-mt19937";
import { describe, expect, it } from "vitest";

import {
  type BinaryCase,
  benjaminiYekutieli,
  compareBinary,
  createRng,
  EstimandError,
  exactStratifiedTest,
  fixedCasesFloor,
  holm,
  sampledCasesFloor,
  sampledCasesNeeded,
  scoreDifferenceInterval,
  signFlipInterval,
  signFlipTest,
  tangoInterval,
  wilson,
} from "../src/index.ts";

const TOL = 1e-9;

describe("multiplicity", () => {
  it("Holm matches the step-down values computed by hand", () => {
    const adjusted = holm([0.01, 0.04, 0.03, 0.005]);
    [0.03, 0.06, 0.06, 0.02].forEach((v, i) => expect(adjusted[i]).toBeCloseTo(v, 12));
  });

  it("Benjamini–Yekutieli matches the values computed by hand", () => {
    const c = 1 + 1 / 2 + 1 / 3 + 1 / 4;
    const adjusted = benjaminiYekutieli([0.01, 0.04, 0.03, 0.005]);
    [0.005 * 4 * c, 0.03 * (4 / 3) * c, 0.03 * (4 / 3) * c, 0.005 * 4 * c].forEach((v, i) =>
      expect(adjusted[i]).toBeCloseTo(v, 12),
    );
  });

  it("adjusted p-values are never below the raw ones, never above 1, and keep their order", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 20 }),
        (ps) => {
          for (const adjust of [holm, benjaminiYekutieli]) {
            const a = adjust(ps);
            ps.forEach((p, i) => {
              expect(a[i]).toBeGreaterThanOrEqual(p - TOL);
              expect(a[i]).toBeLessThanOrEqual(1);
            });
            ps.forEach((p, i) =>
              ps.forEach((q, j) =>
                p < q ? expect(a[i]).toBeLessThanOrEqual((a[j] as number) + TOL) : undefined,
              ),
            );
          }
        },
      ),
      { seed: 20261115 },
    );
  });
});

describe("exact stratified conditional test", () => {
  it("equals Fisher's one-sided exact test for one stratum (1 / C(10, 5))", () => {
    const p = exactStratifiedTest(
      [{ candidate: { successes: 0, trials: 5 }, base: { successes: 5, trials: 5 } }],
      "less",
    ).p;
    expect(p).toBeCloseTo(1 / 252, 12);
  });

  it("convolves strata: two strata of 0/2 against 2/2 give (1/6)^2", () => {
    const stratum = { candidate: { successes: 0, trials: 2 }, base: { successes: 2, trials: 2 } };
    expect(exactStratifiedTest([stratum, stratum], "less").p).toBeCloseTo(1 / 36, 12);
  });

  it("is 1 when every stratum is uninformative", () => {
    const stable = { candidate: { successes: 2, trials: 2 }, base: { successes: 2, trials: 2 } };
    expect(exactStratifiedTest([stable, stable, stable], "less").p).toBeCloseTo(1, 12);
  });
});

describe("sign-flip randomisation", () => {
  it("enumerates every pattern for few families", () => {
    expect(signFlipTest([1, 2, 3], 0, "greater").p).toBeCloseTo(1 / 8, 12);
    expect(signFlipTest([1, 2, 3], 0, "greater").method).toBe("sign-flip-exact");
  });

  it("samples with a seeded generator for many families and never returns p = 0", () => {
    const diffs = Array.from({ length: 40 }, () => 1);
    const result = signFlipTest(diffs, 0, "greater", { rng: createRng(7), resamples: 999 });
    expect(result.p).toBeCloseTo(1 / 1000, 12);
    expect(() => signFlipTest(diffs, 0, "greater")).toThrow("seeded generator");
  });

  it("inverts into an interval that contains the estimate", () => {
    const i = signFlipInterval([0.1, -0.2, 0.05, 0, 0.3, -0.1, 0.2], 0.95, "two");
    expect(i.lower).toBeLessThanOrEqual(i.estimate);
    expect(i.upper).toBeGreaterThanOrEqual(i.estimate);
  });
});

describe("generator", () => {
  it("is the 32-bit Mersenne Twister: the reference output for seed 5489 is 3499211612", () => {
    expect(mt19937.factory({ seed: 5489 })()).toBe(3499211612);
  });

  it("is deterministic for a seed and different across seeds", () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const seqA = Array.from({ length: 5 }, () => a.uniform());
    expect(Array.from({ length: 5 }, () => b.uniform())).toEqual(seqA);
    expect(Array.from({ length: 5 }, () => c.uniform())).not.toEqual(seqA);
    for (const u of seqA) expect(u >= 0 && u < 1).toBe(true);
  });

  it("refuses a seed outside the generator's range", () => {
    expect(() => createRng(0)).toThrow(RangeError);
    expect(() => createRng(2 ** 32)).toThrow(RangeError);
  });
});

describe("intervals: invariants", () => {
  it("score intervals contain the estimate and stay in [-1, 1]; one-sided bounds are tighter", () => {
    const counts = fc.integer({ min: 1, max: 6 }).chain((n) =>
      fc.record({
        n: fc.constant(n),
        x1: fc.integer({ min: 0, max: n }),
        x2: fc.integer({ min: 0, max: n }),
      }),
    );
    fc.assert(
      fc.property(fc.array(counts, { minLength: 1, maxLength: 8 }), (strata) => {
        const s = strata.map(({ n, x1, x2 }) => ({
          candidate: { successes: x1, trials: n },
          base: { successes: x2, trials: n },
        }));
        const two = scoreDifferenceInterval(s, 0.9, "two", {
          biasCorrection: true,
          skewnessCorrection: false,
        });
        const one = scoreDifferenceInterval(s, 0.95, "lower", {
          biasCorrection: true,
          skewnessCorrection: false,
        });
        expect(two.lower).toBeLessThanOrEqual(two.estimate + 1e-9);
        expect(two.upper).toBeGreaterThanOrEqual(two.estimate - 1e-9);
        expect(two.lower).toBeGreaterThanOrEqual(-1);
        expect(two.upper).toBeLessThanOrEqual(1);
        // A one-sided 95% bound is the lower end of the two-sided 90% interval.
        expect(Math.abs(one.lower - two.lower)).toBeLessThan(1e-9);
      }),
      { seed: 20261115, numRuns: 300 },
    );
  });

  it("Wilson never leaves [0, 1] and widens as the level rises", () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 1, max: 500 })
          .chain((n) => fc.tuple(fc.constant(n), fc.integer({ min: 0, max: n }))),
        ([n, x]) => {
          const a = wilson({ successes: x, trials: n }, 0.9);
          const b = wilson({ successes: x, trials: n }, 0.99);
          expect(a.lower).toBeGreaterThanOrEqual(0);
          expect(a.upper).toBeLessThanOrEqual(1);
          expect(b.lower).toBeLessThanOrEqual(a.lower + 1e-12);
          expect(b.upper).toBeGreaterThanOrEqual(a.upper - 1e-12);
        },
      ),
      { seed: 20261115 },
    );
  });

  it("rejects invalid counts", () => {
    expect(() => wilson({ successes: 3, trials: 2 })).toThrow(RangeError);
    expect(() => tangoInterval({ both: -1, candidateOnly: 0, baseOnly: 0, neither: 0 })).toThrow(
      RangeError,
    );
  });
});

describe("power", () => {
  it("the fixed-cases floor shrinks with cases and replicates", () => {
    expect(fixedCasesFloor(60, 2)).toBeLessThan(fixedCasesFloor(17, 2));
    expect(fixedCasesFloor(60, 3)).toBeLessThan(fixedCasesFloor(60, 2));
    expect(fixedCasesFloor(60, 2)).toBeGreaterThan(0);
  });

  it("the sampled-cases floor is near z^2 / (n + z^2) and the sample-size rule matches 6.18 d / delta^2", () => {
    const z2 = 1.6448536269514722 ** 2;
    expect(Math.abs(sampledCasesFloor(60) - z2 / (60 + z2))).toBeLessThan(0.01);
    expect(sampledCasesNeeded(0.1, 0.05)).toBe(Math.ceil((6.182557 * 0.1) / 0.0025));
  });
});

const cases = (r: number, n: number): BinaryCase[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    base: Array.from({ length: r }, () => 1 as const),
    candidate: Array.from({ length: r }, () => 1 as const),
  }));

describe("method choice per estimand", () => {
  it("fixed-cases needs at least two replicates per case and arm", () => {
    expect(() =>
      compareBinary({ estimand: "fixed-cases", cases: cases(1, 20), alpha: 0.05, margin: 0.1 }),
    ).toThrow(EstimandError);
    const result = compareBinary({
      estimand: "fixed-cases",
      cases: cases(2, 20),
      alpha: 0.05,
      margin: 0.1,
    });
    expect(result.difference.method).toMatch(/^stratified-score-rd/);
    expect(result.difference.sided).toBe("lower");
  });

  it("sampled-cases uses Tango for one trial per case, and sign-flip on families otherwise", () => {
    expect(
      compareBinary({ estimand: "sampled-cases", cases: cases(1, 20), alpha: 0.05, margin: 0.1 })
        .difference.method,
    ).toMatch(/^tango/);
    const families = cases(1, 20).map((c, i) => ({ ...c, family: `f${i % 5}` }));
    expect(
      compareBinary({ estimand: "sampled-cases", cases: families, alpha: 0.05, margin: 0.1 })
        .difference.method,
    ).toMatch(/^sign-flip/);
  });

  it("drops cases with one arm missing and reports them", () => {
    const input = [...cases(2, 5), { id: "x", base: [1, 1] as const, candidate: [] as const }];
    expect(
      compareBinary({ estimand: "fixed-cases", cases: input, alpha: 0.05, margin: 0.1 })
        .droppedCases,
    ).toBe(1);
  });
});
