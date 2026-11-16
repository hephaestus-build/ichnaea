// The generator and the normal functions are Ichnaea's own, so the stats package has no runtime
// dependency. They are pinned against independent implementations, run as test-only oracles:
// numpy's MT19937 (scripts/stats/reference-mt19937.py), R's pnorm and qnorm (scripts/stats/reference-normal.R),
// mpmath at 60 digits on a dense grid (scripts/stats/reference-normal-mpmath.py), and the coefficients
// as printed in R's source (scripts/stats/reference-normal-coefficients.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createRng, pnorm, qnorm } from "../../src/stats/index.ts";
import { mt19937 } from "../../src/stats/mt19937.ts";
import {
  PNORM_BOUNDS,
  PNORM_COEFFICIENTS,
  QNORM_BOUNDS,
  QNORM_COEFFICIENTS,
} from "../../src/stats/normal-coefficients.ts";

const read = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, name), "utf8"));

const numpy = read("reference-numpy-mt19937.json") as {
  cases: Array<{ seed: number; raw: number[]; uniform: number[] }>;
};
const r = read("reference-r-normal.json") as {
  pnorm: Array<[number, number]>;
  qnorm: Array<[number, number | "inf" | "-inf"]>;
};

const mpmath = read("reference-mpmath-normal.json") as {
  constants: { one_over_sqrt_2pi: number; sqrt_32: number; two_pi: number };
  pnorm: Array<[number, number]>;
  qnorm: Array<[number, number]>;
};
const coefficients = read("reference-normal-coefficients.json") as {
  pnorm: Record<"a" | "b" | "c" | "d" | "p" | "q", string[]>;
  qnorm: Record<"central" | "low" | "far", { numerator: string[]; denominator: string[] }>;
  pnormBounds: Record<keyof typeof PNORM_BOUNDS, string>;
  qnormBounds: Record<keyof typeof QNORM_BOUNDS, string>;
};

const parse = (xs: readonly string[]): number[] => xs.map(Number);
const slack = (v: number): number => 4 * Number.EPSILON * Math.abs(v);
const numbers = (o: Record<string, string>): Record<string, number> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)]));

const value = (v: number | "inf" | "-inf"): number =>
  v === "inf" ? Number.POSITIVE_INFINITY : v === "-inf" ? Number.NEGATIVE_INFINITY : v;

/**
 * Within `bound` times ε·|expected| (ε = 2^-52, so between `bound` and 2·`bound` units in the last
 * place), plus 4 subnormal steps for results near the bottom of the double range. Against the
 * 60-digit values the worst measured are given in VALIDATION.md.
 */
function expectClose(actual: number, expected: number, bound = 4): void {
  if (actual === expected) return;
  const tolerance = bound * Number.EPSILON * Math.abs(expected) + 4 * Number.MIN_VALUE;
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance);
}

describe("generator: numpy MT19937 with legacy integer seeding", () => {
  it("covers seeds at both ends of the range and sequences across two state regenerations", () => {
    expect(numpy.cases.map((c) => c.seed)).toEqual([1, 42, 5489, 2026, 4294967295]);
    for (const c of numpy.cases) expect(c.raw.length).toBeGreaterThan(2 * 624);
  });

  it.each(numpy.cases)("gives numpy's raw 32-bit outputs for seed $seed", ({ seed, raw }) => {
    const next = mt19937(seed);
    expect(raw.map(() => next())).toEqual(raw);
  });

  it.each(numpy.cases)(
    "gives numpy's random_sample doubles for seed $seed",
    ({ seed, uniform }) => {
      const rng = createRng(seed);
      expect(uniform.map(() => rng.uniform())).toEqual(uniform);
    },
  );

  it("starts with 3499211612 for seed 5489, the reference implementation's default", () => {
    expect(mt19937(5489)()).toBe(3499211612);
  });
});

describe("normal functions: R's pnorm and qnorm", () => {
  it("covers both tails down to subnormal probabilities", () => {
    expect(Math.min(...r.pnorm.map(([x]) => x))).toBeLessThanOrEqual(-38);
    expect(Math.max(...r.pnorm.map(([x]) => x))).toBeGreaterThanOrEqual(38);
    expect(Math.min(...r.qnorm.map(([p]) => p))).toBeLessThanOrEqual(1e-300);
  });

  // Same algorithm, same order of operations: only the libm functions differ from R's.
  it.each(r.pnorm)("pnorm(%d) matches R within 2 ε·|v|", (x, expected) => {
    expectClose(pnorm(x), expected, 2);
  });

  it.each(r.qnorm)("qnorm(%d) matches R within 2 ε·|v|", (p, expected) => {
    expectClose(qnorm(p), value(expected), 2);
  });

  it("uses exactly the coefficients printed in R's source", () => {
    for (const name of ["a", "b", "c", "d", "p", "q"] as const) {
      expect(PNORM_COEFFICIENTS[name], `pnorm ${name}`).toEqual(parse(coefficients.pnorm[name]));
    }
    for (const branch of ["central", "low", "far"] as const) {
      expect(QNORM_COEFFICIENTS[branch].numerator).toEqual(
        parse(coefficients.qnorm[branch].numerator),
      );
      expect(QNORM_COEFFICIENTS[branch].denominator).toEqual(
        parse(coefficients.qnorm[branch].denominator),
      );
    }
  });

  it("uses exactly the branch bounds printed in R's source", () => {
    expect(PNORM_BOUNDS).toEqual(numbers(coefficients.pnormBounds));
    expect(QNORM_BOUNDS).toEqual(numbers(coefficients.qnormBounds));
  });

  it("uses the correctly rounded constants", () => {
    const source = readFileSync(join(import.meta.dirname, "../../src/stats/normal.ts"), "utf8");
    for (const constant of Object.values(mpmath.constants)) {
      expect(source).toContain(String(constant));
    }
  });

  it("covers a dense grid with every branch boundary, and subnormal probabilities", () => {
    expect(mpmath.pnorm.length).toBeGreaterThan(4000);
    expect(mpmath.qnorm.length).toBeGreaterThan(3000);
    expect(mpmath.qnorm.some(([p]) => p < 2.5e-317)).toBe(true);
    expect(r.qnorm.some(([p]) => p < 2.5e-317)).toBe(true);
  });

  it("pnorm is within 2.5 ε·|v| of the 60-digit value for |x| <= 1, and 4 ε·|v| elsewhere", () => {
    for (const [x, expected] of mpmath.pnorm) {
      expectClose(pnorm(x), expected, Math.abs(x) <= 1 ? 2.5 : 4);
    }
  });

  it("qnorm is within 4 ε·|v| of the 60-digit value everywhere on the grid", () => {
    for (const [p, expected] of mpmath.qnorm) expectClose(qnorm(p), expected);
  });

  // Below about 2.5e-317, qnorm uses R's asymptotic expansion, ported operation for operation, so
  // it agrees with R to the last bit or one unit beyond.
  it("qnorm follows R's asymptotic expansion for subnormal p", () => {
    const subnormal = r.qnorm.filter(([p]) => p < 2.5e-317);
    expect(subnormal.length).toBeGreaterThan(150);
    for (const [p, expected] of subnormal) {
      const v = value(expected);
      expect(Math.abs(qnorm(p) - v), `qnorm(${p})`).toBeLessThanOrEqual(
        Number.EPSILON * Math.abs(v),
      );
    }
  });

  it("handles the edges of its domain", () => {
    expect(pnorm(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(pnorm(Number.POSITIVE_INFINITY)).toBe(1);
    expect(pnorm(-38.4674)).toBe(0);
    expect(pnorm(8.2924)).toBe(1);
    expect(pnorm(Number.NaN)).toBeNaN();
    expect(qnorm(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(qnorm(1)).toBe(Number.POSITIVE_INFINITY);
    for (const p of [-1e-12, 1 + 1e-12, Number.NaN]) expect(qnorm(p)).toBeNaN();
  });

  it("is non-decreasing", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -40, max: 10, noNaN: true }),
        fc.double({ min: -40, max: 10, noNaN: true }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          // Rounding makes neighbouring doubles wobble by up to 2.4 ε·|v| (measured across every
          // branch boundary), so a decrease counts only beyond 4 ε·|v|.
          expect(pnorm(lo)).toBeLessThanOrEqual(pnorm(hi) + slack(pnorm(hi)));
          const [qlo, qhi] = [qnorm(pnorm(lo)), qnorm(pnorm(hi))];
          // pnorm is 0 below -38.4674, where qnorm gives -Infinity and a slack is undefined.
          expect(qlo <= qhi || qlo - qhi <= slack(qhi)).toBe(true);
        },
      ),
    );
  });

  // Above the median, p is close to 1 and has too few bits to fix x, so the inverse is checked
  // where p keeps its full relative precision.
  it("is inverted by qnorm up to the median", () => {
    fc.assert(
      fc.property(fc.double({ min: -37, max: 0, noNaN: true }), (x) => {
        expect(Math.abs(qnorm(pnorm(x)) - x)).toBeLessThanOrEqual(1e-13 * Math.max(1, -x));
      }),
    );
  });
});
