import { describe, expect, it } from "vitest";

import {
  alertDetectableRate,
  fidelityCheck,
  intraclassCorrelation,
  kishDesignEffect,
  pnorm,
  qnorm,
  scoreDifferenceInterval,
} from "../../src/stats/index.ts";

// The bootstrap variance of a cell mean is s²(r − 1)/r²; with r/(r − 1) it is s²/r, with s² the
// cell's own unbiased within-cell variance.
const mean = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
const ss = (v: readonly number[]): number => v.reduce((a, y) => a + (y - mean(v)) ** 2, 0);
const cell = (v: readonly number[]): number => ss(v) / (v.length - 1) / v.length;
const pooled = (runs: readonly (readonly number[])[]): number =>
  runs.reduce((a, v) => a + ss(v), 0) / runs.reduce((a, v) => a + v.length - 1, 0);

describe("the replay fidelity check", () => {
  it("uses the stratified score interval at 90% for binary measures", () => {
    const cases = [
      { replayed: [1, 1], recorded: [1, 0] },
      { replayed: [0, 1], recorded: [0, 1] },
      { replayed: [1, 1], recorded: [1, 1] },
      { replayed: [0, 0], recorded: [1, 0] },
    ];
    const result = fidelityCheck({ valueType: "binary", cases, margin: 0.5 });
    const reference = scoreDifferenceInterval(
      cases.map((c) => ({
        candidate: { successes: c.replayed.reduce((a, b) => a + b, 0), trials: 2 },
        base: { successes: c.recorded.reduce((a, b) => a + b, 0), trials: 2 },
      })),
      0.9,
      "two",
      { weights: "equal" },
    );
    expect(result.interval).toMatchObject({
      lower: reference.lower,
      upper: reference.upper,
      level: 0.9,
      coverage: "not-validated",
    });
    expect(result.shown).toBe(reference.lower > -0.5 && reference.upper < 0.5);
  });

  it("refuses scores at one trial per case", () => {
    const result = fidelityCheck({
      valueType: "score",
      cases: [
        { replayed: [0.5], recorded: [0.4] },
        { replayed: [0.9], recorded: [0.8, 0.7] },
      ],
      margin: 0.1,
    });
    expect(result).toMatchObject({
      interval: null,
      shown: false,
      reason: "NOT_CHECKABLE_AT_ONE_TRIAL",
    });
  });

  it("gives scores the within-case variance with the r/(r − 1) correction", () => {
    const cases = [
      { replayed: [0.5, 0.7], recorded: [0.6, 0.6] },
      { replayed: [0.2, 0.4, 0.3], recorded: [0.1, 0.5] },
      { replayed: [0.9, 0.9], recorded: [0.8, 1] },
    ];
    const result = fidelityCheck({ valueType: "score", cases, margin: 0.2 });
    const estimate = cases.reduce((a, c) => a + mean(c.replayed) - mean(c.recorded), 0) / 3;
    const variance = cases.reduce((a, c) => a + cell(c.replayed) + cell(c.recorded), 0) / 9;
    const half = qnorm(0.95) * Math.sqrt(variance);
    expect(result.interval!.estimate).toBeCloseTo(estimate, 14);
    expect(result.interval!.lower).toBeCloseTo(estimate - half, 14);
    expect(result.interval!.upper).toBeCloseTo(estimate + half, 14);
    expect(result.interval!.method).toBe("within-case-variance");
    expect(result.shown).toBe(true);
  });

  it("gives each cell its own variance, which pooling would understate", () => {
    // Two noisy cells at r = 2 and a quiet one at r = 3. Each cell's own s²/r sums to 0.04 + 0.04 +
    // 0 = 0.080; a pooled s²ₚ = 0.16/4 = 0.04 gives 0.02 + 0.02 + 0.04/3 ≈ 0.053, too small.
    const replayed = [
      [0.2, 0.6],
      [0.2, 0.6],
      [0.5, 0.5, 0.5],
    ];
    const cases = replayed.map((r) => ({ replayed: r, recorded: [0.4, 0.4] }));
    const own = replayed.reduce((a, v) => a + cell(v), 0);
    const pooledSum = replayed.reduce((a, v) => a + pooled(replayed) / v.length, 0);
    expect(own).toBeCloseTo(0.08, 14);
    expect(pooledSum).toBeCloseTo(0.16 / 3, 14);
    const result = fidelityCheck({ valueType: "score", cases, margin: 0.5 });
    const half = qnorm(0.95) * Math.sqrt(own / 9);
    expect(result.interval!.upper - result.interval!.estimate).toBeCloseTo(half, 14);
  });

  it("gives the pooled sum when every cell has the same number of trials", () => {
    // At r = 2 everywhere, including cells whose trials agree, Σ s²ᵢ/r = Σ SSᵢ/r = k·s²ₚ/r.
    const replayed = [
      [0.5, 0.5],
      [0.3, 0.3],
      [0.2, 0.4],
    ];
    const recorded = [
      [0.4, 0.4],
      [0.1, 0.5],
      [0.25, 0.25],
    ];
    const cases = replayed.map((r, i) => ({ replayed: r, recorded: recorded[i]! }));
    const own = cases.reduce((a, c) => a + cell(c.replayed) + cell(c.recorded), 0);
    expect(own).toBeCloseTo((3 * (pooled(replayed) + pooled(recorded))) / 2, 14);
    const result = fidelityCheck({ valueType: "score", cases, margin: 0.5 });
    expect(result.interval!.upper - result.interval!.estimate).toBeCloseTo(
      qnorm(0.95) * Math.sqrt(own / 9),
      14,
    );
  });

  it("does not show fidelity when the interval leaves ±margin, or has no width", () => {
    const far = fidelityCheck({
      valueType: "score",
      cases: [
        { replayed: [0.9, 0.8], recorded: [0.1, 0.2] },
        { replayed: [0.7, 0.9], recorded: [0.2, 0.1] },
      ],
      margin: 0.1,
    });
    expect(far.shown).toBe(false);
    // The mirror: a replay far below its recording leaves the interval under −margin, which only
    // the lower side of the check refuses.
    const below = fidelityCheck({
      valueType: "score",
      cases: [
        { replayed: [0.1, 0.2], recorded: [0.9, 0.8] },
        { replayed: [0.2, 0.1], recorded: [0.7, 0.9] },
      ],
      margin: 0.1,
    });
    expect(below.interval!.upper).toBeLessThan(0.1);
    expect(below.interval!.lower).toBeLessThan(-0.1);
    expect(below.shown).toBe(false);
    const flat = fidelityCheck({
      valueType: "score",
      cases: [{ replayed: [0.5, 0.5], recorded: [0.5, 0.5] }],
      margin: 0.1,
    });
    expect(flat).toMatchObject({ interval: null, shown: false, reason: "ZERO_WIDTH" });
  });

  it("refuses a margin outside (0, 1) and a case without trials in both runs", () => {
    expect(() =>
      fidelityCheck({
        valueType: "score",
        cases: [{ replayed: [1, 1], recorded: [0, 1] }],
        margin: 0,
      }),
    ).toThrow(RangeError);
    expect(() =>
      fidelityCheck({ valueType: "binary", cases: [{ replayed: [], recorded: [1] }], margin: 0.1 }),
    ).toThrow(RangeError);
  });
});

describe("Kish's design effect and the intraclass correlation", () => {
  it("is 1 + (Σm²/Σm − 1)ρ", () => {
    expect(kishDesignEffect([1, 1, 1], 0.5)).toBe(1);
    // Σm² = 4 + 16 + 36 = 56, Σm = 12: 1 + (56/12 − 1)·0.3.
    expect(kishDesignEffect([2, 4, 6], 0.3)).toBeCloseTo(1 + (56 / 12 - 1) * 0.3, 14);
    expect(() => kishDesignEffect([2, 0], 0.1)).toThrow(RangeError);
    expect(() => kishDesignEffect([2, 3], 1.5)).toThrow(RangeError);
  });

  it("estimates ρ by one-way ANOVA, at 0 when it comes out negative", () => {
    // Clusters that differ entirely: within-cluster variance 0, so ρ = 1.
    expect(
      intraclassCorrelation([
        [1, 1],
        [0, 0],
        [1, 1],
      ]),
    ).toBeCloseTo(1, 14);
    // Identical cluster means: between-cluster variance below its expectation, so 0.
    expect(
      intraclassCorrelation([
        [1, 0],
        [0, 1],
        [1, 0],
      ]),
    ).toBe(0);
    expect(() => intraclassCorrelation([[1, 0]])).toThrow(RangeError);
  });
});

describe("the true rate that an alert rule finds 4 times in 5", () => {
  it("solves P(far bound beyond t) = power under the normal approximation at n_eff", () => {
    const n = 400;
    const deff = kishDesignEffect(
      Array.from({ length: 100 }, () => 4),
      0.2,
    );
    const result = alertDetectableRate({
      threshold: 0.8,
      rule: "below",
      traces: n,
      designEffect: deff,
    });
    const nEff = n / deff;
    expect(result.effectiveTraces).toBeCloseTo(nEff, 12);
    expect(result.label).toBe("approximate");
    const p = result.rate!;
    const sd = (x: number) => Math.sqrt((x * (1 - x)) / nEff);
    // The rule fires when p̂ + z·sd(t) < t; at the returned rate that happens with probability 0.8.
    expect(pnorm((0.8 - qnorm(0.95) * sd(0.8) - p) / sd(p))).toBeCloseTo(0.8, 9);
    expect(p).toBeLessThan(0.8);
  });

  it("mirrors for an `above` rule, and needs fewer traces at a smaller design effect", () => {
    const above = alertDetectableRate({
      threshold: 0.2,
      rule: "above",
      traces: 400,
      designEffect: 1.6,
    });
    const below = alertDetectableRate({
      threshold: 0.8,
      rule: "below",
      traces: 400,
      designEffect: 1.6,
    });
    expect(above.rate).toBeCloseTo(1 - below.rate!, 12);
    const tight = alertDetectableRate({
      threshold: 0.8,
      rule: "below",
      traces: 400,
      designEffect: 1,
    });
    expect(tight.rate).toBeGreaterThan(below.rate!);
  });

  it("finds no rate when the window is too small", () => {
    const result = alertDetectableRate({
      threshold: 0.05,
      rule: "below",
      traces: 10,
      designEffect: 1,
    });
    expect(result.rate).toBeNull();
  });
});
