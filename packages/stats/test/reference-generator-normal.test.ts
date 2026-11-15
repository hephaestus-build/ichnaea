// The generator and the normal functions are Ichnaea's own, so the stats package has no runtime
// dependency. They are pinned against independent implementations, run as test-only oracles:
// numpy's MT19937 (scripts/reference-mt19937.py) and R's pnorm and qnorm (scripts/reference-normal.R).
import { readFileSync } from "node:fs";
import { join } from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createRng, pnorm, qnorm } from "../src/index.ts";
import { mt19937 } from "../src/mt19937.ts";

const read = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, name), "utf8"));

const numpy = read("reference-numpy-mt19937.json") as {
  cases: Array<{ seed: number; raw: number[]; uniform: number[] }>;
};
const r = read("reference-r-normal.json") as {
  pnorm: Array<[number, number]>;
  qnorm: Array<[number, number | "inf" | "-inf"]>;
};

const value = (v: number | "inf" | "-inf"): number =>
  v === "inf" ? Number.POSITIVE_INFINITY : v === "-inf" ? Number.NEGATIVE_INFINITY : v;

/** At most 4 units in the last place; subnormal results keep fewer significant bits. */
function expectClose(actual: number, expected: number): void {
  if (actual === expected) return;
  const tolerance = 4 * Number.EPSILON * Math.abs(expected) + 2 ** -1060;
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

  it.each(r.pnorm)("pnorm(%d) matches R", (x, expected) => {
    expectClose(pnorm(x), expected);
  });

  it.each(r.qnorm)("qnorm(%d) matches R", (p, expected) => {
    expectClose(qnorm(p), value(expected));
  });

  it("handles the edges of its domain", () => {
    expect(pnorm(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(pnorm(Number.POSITIVE_INFINITY)).toBe(1);
    expect(pnorm(-41)).toBe(0);
    expect(pnorm(Number.NaN)).toBeNaN();
    expect(qnorm(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(qnorm(1)).toBe(Number.POSITIVE_INFINITY);
    for (const p of [-1e-12, 1 + 1e-12, Number.NaN]) expect(qnorm(p)).toBeNaN();
  });

  it("is symmetric", () => {
    fc.assert(
      fc.property(fc.double({ min: -8, max: 8, noNaN: true }), (x) => {
        expect(Math.abs(pnorm(-x) - (1 - pnorm(x)))).toBeLessThanOrEqual(4 * Number.EPSILON);
      }),
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

describe("package", () => {
  it("has no runtime dependency", () => {
    const manifest = read("../package.json") as Record<string, unknown>;
    expect(manifest["dependencies"] ?? {}).toEqual({});
    expect(manifest["peerDependencies"] ?? {}).toEqual({});
  });
});
