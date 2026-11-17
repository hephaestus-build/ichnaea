import { describe, expect, it } from "vitest";

import {
  chiSquareQuantile,
  clopperPearson,
  neverCasesNeeded,
  type NeverClaim,
  neverClaim,
  overdispersion,
  type Stratum,
  stratifiedZ,
} from "../../src/stats/index.ts";

const stratum = (cs: number, cn: number, bs: number, bn: number): Stratum => ({
  candidate: { successes: cs, trials: cn },
  base: { successes: bs, trials: bn },
});

const bad = (overrides: object) => (): NeverClaim =>
  neverClaim({
    violations: 0,
    cases: 10,
    ceiling: 0.1,
    confidence: 0.95,
    detector: { kind: "deterministic" },
    ...overrides,
  });

describe("the must-never ceiling", () => {
  it("shows the ceiling with a deterministic detector at the full level", () => {
    const claim = neverClaim({
      violations: 0,
      cases: 1000,
      ceiling: 0.005,
      confidence: 0.95,
      detector: { kind: "deterministic" },
    });
    expect(claim).toMatchObject({ status: "shown", level: 0.95 });
    expect(claim.bound).toBeCloseTo(1 - 0.05 ** (1 / 1000), 14);
  });

  it("does not show a ceiling that the bound exceeds", () => {
    const claim = neverClaim({
      violations: 3,
      cases: 200,
      ceiling: 0.01,
      confidence: 0.95,
      detector: { kind: "deterministic" },
    });
    expect(claim.status).toBe("not-shown");
    expect(claim.bound).toBeCloseTo(
      clopperPearson({ successes: 3, trials: 200 }, 0.95, "upper").upper,
      14,
    );
  });

  it("splits the level between the violation bound and the sensitivity bound", () => {
    const claim = neverClaim({
      violations: 1,
      cases: 2000,
      ceiling: 0.005,
      confidence: 0.95,
      detector: { kind: "model", sensitivityLower: 0.8 },
    });
    const flagged = clopperPearson({ successes: 1, trials: 2000 }, 0.975, "upper").upper;
    expect(claim).toMatchObject({ level: 0.975, status: "shown" });
    expect(claim.bound).toBeCloseTo(flagged / 0.8, 14);
  });

  it("makes no claim when the sensitivity is not bounded above 0", () => {
    const claim = neverClaim({
      violations: 0,
      cases: 5000,
      ceiling: 0.01,
      confidence: 0.95,
      detector: { kind: "model", sensitivityLower: 0 },
    });
    expect(claim).toMatchObject({ status: "no-claim", reason: "SENSITIVITY_NOT_BOUNDED" });
    expect(claim.bound).toBeNull();
  });

  it("bounds only the flagged rate without a calibration record, as a diagnostic", () => {
    const claim = neverClaim({
      violations: 0,
      cases: 1000,
      ceiling: 0.005,
      confidence: 0.95,
      detector: { kind: "model", sensitivityLower: null },
    });
    expect(claim).toMatchObject({ status: "flagged-only", reason: "NO_DETECTOR_CALIBRATION" });
    expect(claim.bound).toBeCloseTo(1 - 0.05 ** (1 / 1000), 14);
  });

  it("caps the violation bound at 1 and refuses bad inputs", () => {
    const claim = neverClaim({
      violations: 50,
      cases: 60,
      ceiling: 0.5,
      confidence: 0.95,
      detector: { kind: "model", sensitivityLower: 0.3 },
    });
    expect(claim.bound).toBe(1);
    expect(bad({ ceiling: 0 })).toThrow(RangeError);
    expect(bad({ ceiling: 1 })).toThrow(RangeError);
    expect(bad({ violations: 11 })).toThrow(RangeError);
    expect(bad({ cases: 0 })).toThrow(RangeError);
    expect(bad({ detector: { kind: "model", sensitivityLower: 1.2 } })).toThrow(RangeError);
  });
});

describe("the must-never planning count", () => {
  it("is ⌈ln α / ln(1 − ceiling)⌉ clean cases with a deterministic detector", () => {
    expect(
      neverCasesNeeded({ ceiling: 0.001, confidence: 0.95, detector: { kind: "deterministic" } }),
    ).toEqual({ cases: 2995 });
    expect(
      neverCasesNeeded({ ceiling: 0.05, confidence: 0.95, detector: { kind: "deterministic" } }),
    ).toEqual({ cases: 59 });
  });

  it("is ⌈ln 0.025 / ln(1 − ceiling·Se_L)⌉ with a calibrated model detector", () => {
    expect(
      neverCasesNeeded({
        ceiling: 0.005,
        confidence: 0.95,
        detector: { kind: "model", sensitivityLower: 0.9 },
      }),
    ).toEqual({ cases: 818 });
    expect(
      neverCasesNeeded({
        ceiling: 0.001,
        confidence: 0.95,
        detector: { kind: "model", sensitivityLower: 0.8 },
      }),
    ).toEqual({ cases: 4610 });
  });

  it("is the smallest n whose claim holds with no violation", () => {
    for (const ceiling of [0.001, 0.003, 0.01, 0.02, 0.05, 0.1, 0.25]) {
      for (const detector of [
        { kind: "deterministic" } as const,
        { kind: "model", sensitivityLower: 0.7 } as const,
      ]) {
        const { cases } = neverCasesNeeded({ ceiling, confidence: 0.95, detector }) as {
          cases: number;
        };
        const claim = (n: number) =>
          neverClaim({ violations: 0, cases: n, ceiling, confidence: 0.95, detector }).status;
        expect(claim(cases), `${ceiling} ${detector.kind}`).toBe("shown");
        expect(claim(cases - 1), `${ceiling} ${detector.kind}`).toBe("not-shown");
      }
    }
  });

  it("names what is missing instead of a count", () => {
    expect(
      neverCasesNeeded({
        ceiling: 0.01,
        confidence: 0.95,
        detector: { kind: "model", sensitivityLower: null },
      }),
    ).toEqual({ cases: null, reason: "NO_DETECTOR_CALIBRATION" });
    expect(
      neverCasesNeeded({
        ceiling: 0.01,
        confidence: 0.95,
        detector: { kind: "model", sensitivityLower: 0 },
      }),
    ).toEqual({ cases: null, reason: "SENSITIVITY_NOT_BOUNDED" });
  });
});

describe("the stratified score statistic of a noise run", () => {
  it("is (O − E)/√V with the hypergeometric moments of each stratum", () => {
    // One stratum, 3 of 4 candidate trials and 1 of 4 base trials pass: t = 4 of N = 8.
    // E = 4·4/8 = 2, V = 4·4·4·4/(8²·7) = 4/7, O = 3.
    const result = stratifiedZ([stratum(3, 4, 1, 4)]);
    expect(result).not.toBeNull();
    expect(result!.z).toBeCloseTo(1 / Math.sqrt(4 / 7), 14);
  });

  it("sums over strata and leaves out a stratum with no information", () => {
    const pooled = stratifiedZ([stratum(3, 4, 1, 4), stratum(2, 2, 2, 2), stratum(0, 3, 1, 3)]);
    // The second stratum (every trial passed) adds nothing. The third: t = 1, N = 6, E = 0.5,
    // V = 3·3·1·5/(36·5) = 0.25.
    expect(pooled!.z).toBeCloseTo((1 - 0.5) / Math.sqrt(4 / 7 + 0.25), 14);
    expect(stratifiedZ([stratum(2, 2, 2, 2), stratum(0, 2, 0, 2)])).toBeNull();
  });
});

describe("the overdispersion ratio across noise runs", () => {
  it("is Σz²/N with the χ²(N) interval, left out a run with V = 0", () => {
    const runs = [
      [stratum(3, 4, 1, 4)],
      [stratum(1, 4, 3, 4), stratum(2, 3, 2, 3)],
      [stratum(2, 2, 2, 2)],
    ];
    const result = overdispersion(runs);
    // Run 1: z² = 1/(4/7). Run 2: O − E = 3 − 4, V = 4/7 + 3·3·4·2/(36·5) = 4/7 + 0.4.
    const z2 = 1 / (4 / 7) + 1 / (4 / 7 + 0.4);
    expect(result.runs).toBe(2);
    expect(result.excluded).toBe(1);
    expect(result.ratio).toBeCloseTo(z2 / 2, 12);
    expect(result.lower).toBeCloseTo(z2 / chiSquareQuantile(0.975, 2), 12);
    expect(result.upper).toBeCloseTo(z2 / chiSquareQuantile(0.025, 2), 12);
    expect(result.method).toBe("chi-square-approximate");
  });

  it("gives no ratio when every run is left out", () => {
    const result = overdispersion([[stratum(2, 2, 2, 2)]]);
    expect(result).toMatchObject({ runs: 0, excluded: 1 });
    expect(result.ratio).toBeNaN();
  });
});

describe("the χ² quantile", () => {
  it("matches closed forms at 2 degrees of freedom and known values", () => {
    // χ²(2) is exponential with mean 2: its p-quantile is −2·ln(1 − p).
    for (const p of [0.025, 0.5, 0.975])
      expect(chiSquareQuantile(p, 2)).toBeCloseTo(-2 * Math.log(1 - p), 10);
    expect(chiSquareQuantile(0.95, 1)).toBeCloseTo(3.841458820694124, 9);
    expect(chiSquareQuantile(0.975, 10)).toBeCloseTo(20.48317735080739, 9);
    expect(() => chiSquareQuantile(1, 3)).toThrow(RangeError);
    expect(() => chiSquareQuantile(0.5, 0)).toThrow(RangeError);
  });
});
