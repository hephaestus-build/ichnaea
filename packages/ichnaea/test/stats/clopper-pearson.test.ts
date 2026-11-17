import { describe, expect, it } from "vitest";

import { clopperPearson, pooledClopperPearson } from "../../src/stats/clopper-pearson.ts";
import type { Interval, Sided } from "../../src/stats/types.ts";

/** The exact distribution of the number of successes of independent trials at these rates. */
function poissonBinomial(rates: readonly number[]): number[] {
  let d = [1];
  for (const p of rates) {
    const next = Array.from({ length: d.length + 1 }, () => 0);
    d.forEach((mass, k) => {
      next[k]! += mass * (1 - p);
      next[k + 1]! += mass * p;
    });
    d = next;
  }
  return d;
}

type Bound = (successes: number, trials: number, level: number, sided: Sided) => Interval;
const pooled: Bound = (successes, trials, level, sided) =>
  pooledClopperPearson({ successes, trials }, level, sided);
const unadjusted: Bound = (successes, trials, level, sided) =>
  clopperPearson({ successes, trials }, level, sided);

/** The exact probability that the bound covers the mean rate. */
function coverage(rates: readonly number[], bound: Bound, level: number, sided: Sided): number {
  const n = rates.length;
  const mean = rates.reduce((a, b) => a + b, 0) / n;
  return poissonBinomial(rates).reduce((total, mass, x) => {
    const b = bound(x, n, level, sided);
    return b.lower <= mean && mean <= b.upper ? total + mass : total;
  }, 0);
}

const zeros = (n: number): number[] => Array.from({ length: n }, () => 0);
const ones = (n: number): number[] => Array.from({ length: n }, () => 1);

describe("Clopper–Pearson on a pooled count of trials at unequal rates", () => {
  it("misses the mean more than α unadjusted, and not at the adjusted level: n = 2, rates 0 and 0.0505", () => {
    const rates = [0, 0.0505];
    expect(coverage(rates, unadjusted, 0.95, "lower")).toBeCloseTo(0.9495, 10);
    expect(coverage(rates, unadjusted, 0.95, "lower")).toBeLessThan(0.95);
    expect(coverage(rates, pooled, 0.95, "lower")).toBeGreaterThanOrEqual(0.95);
  });

  it("holds at the one-trial limit, n = 200, where the unadjusted miss nears −ln(1 − α)", () => {
    // One trial at rate a, the rest at 0: unadjusted, one success excludes the mean a/n whenever
    // a < n(1 − (1 − α)^(1/n)), which tends to −ln(1 − α) = 0.0513 at α = 0.05.
    const limit = 200 * (1 - 0.95 ** (1 / 200));
    const near = [limit * 0.999, ...zeros(199)];
    expect(coverage(near, unadjusted, 0.95, "lower")).toBeLessThan(0.9488);
    for (let a = 0.0005; a <= 0.08; a += 0.0005)
      expect(coverage([a, ...zeros(199)], pooled, 0.95, "lower"), `a ${a}`).toBeGreaterThanOrEqual(
        0.95,
      );
  });

  it("holds for a mix of trials that never, sometimes and always pass", () => {
    for (let a = 0.01; a < 1; a += 0.01) {
      const rates = [...zeros(4), a, a, a, ...ones(3)];
      for (const sided of ["lower", "upper", "two"] as const)
        expect(coverage(rates, pooled, 0.95, sided), `${sided} a ${a}`).toBeGreaterThanOrEqual(
          0.95,
        );
    }
  });

  it("holds for the upper bound by symmetry: n = 2, rates 1 and 0.9495", () => {
    const rates = [1, 1 - 0.0505];
    expect(coverage(rates, unadjusted, 0.95, "upper")).toBeCloseTo(0.9495, 10);
    expect(coverage(rates, pooled, 0.95, "upper")).toBeGreaterThanOrEqual(0.95);
  });

  it("holds at 97.5% and for the two-sided 95% interval, per tail at 1 − e^(−α/2)", () => {
    const limit = 2 * (1 - 0.975 ** (1 / 2));
    expect(coverage([limit * 0.999, 0], unadjusted, 0.975, "lower")).toBeLessThan(0.975);
    expect(coverage([limit * 0.999, 0], pooled, 0.975, "lower")).toBeGreaterThanOrEqual(0.975);
    for (let a = 0.001; a <= 0.08; a += 0.001) {
      expect(coverage([a, 0], pooled, 0.975, "lower"), `a ${a}`).toBeGreaterThanOrEqual(0.975);
      expect(coverage([a, 0], pooled, 0.95, "two"), `a ${a}`).toBeGreaterThanOrEqual(0.95);
    }
  });

  it("runs at 1 − e^(−α) per bound, keeps the level asked for, and refuses an adjusted level above 1/4", () => {
    const count = { successes: 7, trials: 20 };
    expect(pooledClopperPearson(count, 0.95, "lower")).toEqual({
      ...clopperPearson(count, Math.exp(-0.05), "lower"),
      level: 0.95,
      method: "clopper-pearson-adjusted",
    });
    expect(pooledClopperPearson(count, 0.95, "two").lower).toBe(
      clopperPearson(count, 1 - 2 * (1 - Math.exp(-0.025)), "two").lower,
    );
    // α = 0.4 one-sided: α′ = 0.33. α = 0.6 two-sided: 0.26 per tail.
    expect(() => pooledClopperPearson(count, 0.6, "lower")).toThrow(RangeError);
    expect(() => pooledClopperPearson(count, 0.4, "two")).toThrow(RangeError);
    expect(() => pooledClopperPearson(count, 0.75, "lower")).not.toThrow();
  });
});
