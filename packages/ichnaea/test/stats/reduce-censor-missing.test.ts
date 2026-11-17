import { describe, expect, it } from "vitest";

import {
  kaplanMeier,
  missingDifferenceTest,
  reduceTrials,
  restrictedDifference,
  restrictedMean,
  survivalQuantile,
} from "../../src/stats/index.ts";

describe("reductions over the trials of a case", () => {
  it("estimates pass^k and pass@k without bias", () => {
    // r = 4, c = 2: C(2, 2)/C(4, 2) = 1/6 and 1 − C(2, 2)/C(4, 2) = 5/6.
    expect(reduceTrials([1, 0, 1, 0], { all: { k: 2 } })).toBeCloseTo(1 / 6, 15);
    expect(reduceTrials([1, 0, 1, 0], { any: { k: 2 } })).toBeCloseTo(5 / 6, 15);
    expect(reduceTrials([1, 1, 1], { all: { k: 3 } })).toBe(1);
    expect(reduceTrials([0, 0, 1], { any: { k: 1 } })).toBeCloseTo(1 / 3, 15);
    expect(reduceTrials([0, 1, 1], { all: { k: 3 } })).toBe(0);
  });

  it("averages to the per-trial rate at k = 1", () => {
    expect(reduceTrials([1, 0, 1, 1, 0], { all: { k: 1 } })).toBeCloseTo(0.6, 15);
  });

  it("applies the declared tie rule to a majority", () => {
    expect(reduceTrials([1, 1, 0], { majority: { tie: "fail" } })).toBe(1);
    expect(reduceTrials([1, 0], { majority: { tie: "fail" } })).toBe(0);
    expect(reduceTrials([1, 0], { majority: { tie: "pass" } })).toBe(1);
  });

  it("refuses r < k, a k below 1 and values that are not 0 or 1", () => {
    expect(() => reduceTrials([1, 0], { all: { k: 3 } })).toThrow(RangeError);
    expect(() => reduceTrials([1, 0], { any: { k: 0 } })).toThrow(RangeError);
    expect(() => reduceTrials([1, 0.5], { all: { k: 1 } })).toThrow(RangeError);
    expect(() => reduceTrials([], { majority: { tie: "pass" } })).toThrow(RangeError);
  });
});

describe("censoring at the plan's limit", () => {
  // Events at 1, 2 and 3; censored at 2 and 4.
  const sample = [
    { time: 1, censored: false },
    { time: 2, censored: false },
    { time: 2, censored: true },
    { time: 3, censored: false },
    { time: 4, censored: true },
  ];

  it("gives the product-limit curve, with a censored time at risk at its own time", () => {
    expect(kaplanMeier(sample)).toEqual([
      { time: 1, atRisk: 5, events: 1, survival: 0.8 },
      { time: 2, atRisk: 4, events: 1, survival: 0.6000000000000001 },
      { time: 3, atRisk: 2, events: 1, survival: 0.30000000000000004 },
    ]);
  });

  it("gives a quantile, or 'at least' the last time when the curve never reaches it", () => {
    expect(survivalQuantile(sample, 0.5)).toEqual({ value: 3 });
    expect(survivalQuantile(sample, 0.2)).toEqual({ value: 1.5 });
    expect(survivalQuantile(sample, 0.3)).toEqual({ value: 2 });
    expect(survivalQuantile(sample, 0.9)).toEqual({ atLeast: 4 });
    // Uncensored 1, 2, 3, 4: S = 0.5 on [2, 3), so the median is 2.5, the ordinary median.
    const plain = [1, 2, 3, 4].map((time) => ({ time, censored: false }));
    expect(survivalQuantile(plain, 0.5)).toEqual({ value: 2.5 });
    // S = 0.6 from 2 to the end: the 0.4-quantile starts at 2 and is not determined beyond it.
    expect(
      survivalQuantile(
        [1, 2, 5, 5, 5].map((time) => ({ time, censored: time === 5 })),
        0.4,
      ),
    ).toEqual({ atLeast: 2 });
    expect(
      survivalQuantile(
        [
          { time: 6, censored: true },
          { time: 6, censored: true },
          { time: 1, censored: false },
        ],
        0.5,
      ),
    ).toEqual({ atLeast: 6 });
  });

  it("weights trials, so a case counts once whatever its trials", () => {
    const weighted = kaplanMeier([
      { time: 1, censored: false, weight: 0.5 },
      { time: 3, censored: false, weight: 0.5 },
      { time: 2, censored: false, weight: 1 },
    ]);
    expect(weighted.map((s) => s.survival)).toEqual([0.75, 0.25, 0]);
  });

  it("gives the restricted mean as the area under the curve up to the limit", () => {
    expect(restrictedMean(sample, 4)).toBeCloseTo(1 + 0.8 + 0.6 + 0.3, 14);
    expect(restrictedMean(sample, 2.5)).toBeCloseTo(1 + 0.8 + 0.5 * 0.6, 14);
  });

  it("gives the latest time of a large all-censored sample without spreading it onto the stack", () => {
    const large = Array.from({ length: 300_000 }, (_, i) => ({
      time: (i % 997) + 1,
      censored: true,
    }));
    expect(survivalQuantile(large, 0.5)).toEqual({ atLeast: 997 });
  });

  it("refuses a negative time, a weight of 0 and an empty sample", () => {
    expect(() => kaplanMeier([{ time: -1, censored: false }])).toThrow(RangeError);
    expect(() => kaplanMeier([{ time: 1, censored: false, weight: 0 }])).toThrow(RangeError);
    expect(() => kaplanMeier([])).toThrow(RangeError);
    expect(() => survivalQuantile(sample, 1)).toThrow(RangeError);
  });

  it("takes paired differences of min(t, L), counting the censored trials per arm", () => {
    const result = restrictedDifference(
      [
        {
          id: "a",
          base: [{ time: 2, censored: false }],
          candidate: [{ time: 10, censored: true }],
        },
        {
          id: "b",
          base: [
            { time: 1, censored: false },
            { time: 3, censored: false },
          ],
          candidate: [{ time: 2, censored: false }],
        },
        { id: "c", base: [], candidate: [{ time: 1, censored: false }] },
      ],
      10,
    );
    // Case a: 10 − 2 = 8. Case b: 2 − 2 = 0. Case c has no base trial and is left out.
    expect(result).toEqual({ estimate: 4, cases: 2, censored: { base: 0, candidate: 1 } });
  });
});

describe("the exact test on the missing counts", () => {
  it("is the two-sided stratified conditional test of missingness between arms", () => {
    const result = missingDifferenceTest([
      { base: { missing: 0, planned: 10 }, candidate: { missing: 5, planned: 10 } },
    ]);
    // Hypergeometric: P(X = 5) with 20 trials, 5 missing, 10 in the candidate: 252/15504.
    expect(result.p).toBeCloseTo((2 * 252) / 15504, 12);
    expect(result.method).toBe("exact-stratified-conditional-two-sided");
    expect(result.missing).toEqual({ base: 0, candidate: 5 });
  });

  it("gives p = 1 when nothing is missing, and caps at 1", () => {
    expect(
      missingDifferenceTest([
        { base: { missing: 0, planned: 3 }, candidate: { missing: 0, planned: 3 } },
      ]).p,
    ).toBe(1);
    expect(
      missingDifferenceTest([
        { base: { missing: 1, planned: 2 }, candidate: { missing: 1, planned: 2 } },
      ]).p,
    ).toBe(1);
  });

  it("refuses more missing trials than planned", () => {
    expect(() =>
      missingDifferenceTest([
        { base: { missing: 3, planned: 2 }, candidate: { missing: 0, planned: 2 } },
      ]),
    ).toThrow(RangeError);
  });
});
