import { describe, expect, it } from "vitest";

import {
  bcaInterval,
  clopperPearson,
  createRng,
  estimate,
  type EstimateCase,
  hoeffding,
  oneArmScoreInterval,
  wilson,
  wilsonMean,
} from "../../src/stats/index.ts";

const binaryCases = (values: readonly (readonly number[])[], family?: (i: number) => string) =>
  values.map((v, i): EstimateCase => ({
    id: `c${i}`,
    values: v,
    ...(family ? { family: family(i) } : {}),
  }));

describe("Clopper–Pearson", () => {
  it("matches R's binom.test at interior and boundary counts", () => {
    const mid = clopperPearson({ successes: 5, trials: 10 });
    expect(mid.lower).toBeCloseTo(0.187086, 6);
    expect(mid.upper).toBeCloseTo(0.812914, 6);
    expect(mid.method).toBe("clopper-pearson");
    const none = clopperPearson({ successes: 0, trials: 10 });
    expect(none.lower).toBe(0);
    expect(none.upper).toBeCloseTo(1 - 0.025 ** (1 / 10), 14);
    const all = clopperPearson({ successes: 10, trials: 10 });
    expect(all.upper).toBe(1);
    expect(all.lower).toBeCloseTo(0.025 ** (1 / 10), 14);
  });

  it("bounds one side at the full level", () => {
    const upper = clopperPearson({ successes: 0, trials: 299 }, 0.95, "upper");
    expect(upper.lower).toBe(0);
    expect(upper.upper).toBeCloseTo(1 - 0.05 ** (1 / 299), 14);
    const lower = clopperPearson({ successes: 7, trials: 20 }, 0.95, "lower");
    expect(lower.upper).toBe(1);
    expect(lower.lower).toBeCloseTo(clopperPearson({ successes: 7, trials: 20 }, 0.9).lower, 12);
  });

  it("gives [0, 1] with no estimate at zero trials", () => {
    const empty = clopperPearson({ successes: 0, trials: 0 });
    expect(empty).toMatchObject({ lower: 0, upper: 1 });
    expect(empty.estimate).toBeNaN();
  });
});

describe("Wilson on a mean", () => {
  it("equals Wilson on the count when the mean is a whole count", () => {
    const count = wilson({ successes: 7, trials: 20 });
    const mean = wilsonMean(7 / 20, 20);
    expect(mean.lower).toBeCloseTo(count.lower, 14);
    expect(mean.upper).toBeCloseTo(count.upper, 14);
    expect(mean.method).toBe("wilson-mean");
  });

  it("refuses a mean outside [0, 1] or a non-positive n", () => {
    expect(() => wilsonMean(1.1, 10)).toThrow(RangeError);
    expect(() => wilsonMean(0.5, 0)).toThrow(RangeError);
  });
});

describe("Hoeffding's bound on a weighted mean", () => {
  it("has half-width sqrt(ln(2/α)·Σw²/2) on two sides and sqrt(ln(1/α)·Σw²/2) on one", () => {
    const values: number[] = Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? 1 : 0));
    const weights = values.map((_, i) => (i < 20 ? 1 / 40 : 1 / 80));
    const sumSquares = weights.reduce((a, w) => a + w * w, 0);
    const point = values.reduce((a, v, i) => a + v * weights[i]!, 0);
    const two = hoeffding(values, weights);
    expect(two.estimate).toBeCloseTo(point, 14);
    expect(point - two.lower).toBeCloseTo(Math.sqrt((Math.log(2 / 0.05) * sumSquares) / 2), 14);
    const lower = hoeffding(values, weights, 0.95, "lower");
    expect(point - lower.lower).toBeCloseTo(Math.sqrt((Math.log(1 / 0.05) * sumSquares) / 2), 14);
    expect(lower.upper).toBe(1);
  });

  it("clips to [0, 1] and refuses weights that do not sum to 1", () => {
    const wide = hoeffding([1, 0, 1], [0.25, 0.25, 0.5]);
    expect(wide).toMatchObject({ lower: 0, upper: 1 });
    expect(() => hoeffding([1, 0], [0.5, 0.4])).toThrow(RangeError);
    expect(() => hoeffding([1.5], [1])).toThrow(RangeError);
  });
});

describe("the one-arm stratified score interval", () => {
  it("is Wilson for one case", () => {
    const one = oneArmScoreInterval([{ sum: 3, trials: 4, weight: 1 }]);
    const reference = wilson({ successes: 3, trials: 4 });
    expect(one.lower).toBeCloseTo(reference.lower, 9);
    expect(one.upper).toBeCloseTo(reference.upper, 9);
  });

  it("is Wilson on the pooled count for identical cases of equal weight", () => {
    const cells = Array.from({ length: 5 }, () => ({ sum: 2, trials: 3, weight: 1 / 5 }));
    const pooled = oneArmScoreInterval(cells);
    const reference = wilson({ successes: 10, trials: 15 });
    expect(pooled.lower).toBeCloseTo(reference.lower, 9);
    expect(pooled.upper).toBeCloseTo(reference.upper, 9);
  });

  it("reflects under y → 1 − y", () => {
    const cells = [
      { sum: 0, trials: 2, weight: 0.25 },
      { sum: 1.4, trials: 2, weight: 0.25 },
      { sum: 3, trials: 3, weight: 0.5 },
    ];
    const flipped = cells.map((c) => ({ ...c, sum: c.trials - c.sum }));
    const a = oneArmScoreInterval(cells);
    const b = oneArmScoreInterval(flipped);
    expect(a.lower).toBeCloseTo(1 - b.upper, 10);
    expect(a.upper).toBeCloseTo(1 - b.lower, 10);
    expect(a.lower).toBeLessThan(a.estimate);
    expect(a.upper).toBeGreaterThan(a.estimate);
  });

  it("reaches the boundary only when every value lies on it", () => {
    const zeros = oneArmScoreInterval([
      { sum: 0, trials: 2, weight: 0.5 },
      { sum: 0, trials: 3, weight: 0.5 },
    ]);
    expect(zeros.lower).toBe(0);
    expect(zeros.upper).toBeGreaterThan(0);
  });
});

const ones = (k: number, passes: number): EstimateCase[] =>
  binaryCases(Array.from({ length: k }, (_, i) => [i < passes ? 1 : 0]));

describe("estimate: the these-cases study", () => {
  it("uses Clopper–Pearson on the pooled count for binary values at one trial", () => {
    const result = estimate({ valueType: "binary", cases: ones(20, 7) });
    const reference = clopperPearson({ successes: 7, trials: 20 });
    expect(result.estimate).toBeCloseTo(0.35, 14);
    expect(result.interval).toMatchObject({
      method: "clopper-pearson",
      coverage: "conservative",
      lower: reference.lower,
      upper: reference.upper,
    });
    expect(result).toMatchObject({ estimand: "these-cases", weighting: "per-case", cases: 20 });
  });

  it("keeps Clopper–Pearson per family when every family has the same size", () => {
    const cases = binaryCases(
      Array.from({ length: 20 }, (_, i) => [i % 4 === 0 ? 1 : 0]),
      (i) => `f${Math.floor(i / 2)}`,
    );
    const result = estimate({ valueType: "binary", weighting: "per-family", cases });
    expect(result.interval).toMatchObject({ method: "clopper-pearson", coverage: "conservative" });
  });

  it("uses Hoeffding's bound per family when the family sizes differ", () => {
    const cases = binaryCases(
      Array.from({ length: 30 }, (_, i) => [i % 2]),
      (i) => (i < 10 ? `f${i}` : "big"),
    );
    const result = estimate({ valueType: "binary", weighting: "per-family", cases });
    // Ten single-case families and one of twenty: eleven families, weights 1/11 and 1/220.
    const point = (5 + 10 / 20) / 11;
    expect(result.estimate).toBeCloseTo(point, 14);
    expect(result.interval).toMatchObject({ method: "hoeffding", coverage: "conservative" });
    const sumSquares = 10 / 121 + 20 / 220 ** 2;
    expect(point - result.interval!.lower).toBeCloseTo(
      Math.sqrt((Math.log(2 / 0.05) * sumSquares) / 2),
      12,
    );
  });

  it("uses Wilson on the pooled mean for scores at one trial, not validated", () => {
    const cases = binaryCases(Array.from({ length: 12 }, (_, i) => [i / 11]));
    const result = estimate({ valueType: "score", cases });
    const reference = wilsonMean(0.5, 12);
    expect(result.interval).toMatchObject({
      method: "wilson-mean",
      coverage: "not-validated",
      lower: reference.lower,
      upper: reference.upper,
    });
  });

  it("uses the one-arm stratified score interval at two or more trials", () => {
    const cases = binaryCases(
      Array.from({ length: 8 }, (_, i) => [i % 2, 1, ...(i < 4 ? [0] : [])]),
    );
    const result = estimate({ valueType: "binary", cases });
    expect(result.interval).toMatchObject({
      method: "one-arm-stratified-score",
      coverage: "not-validated",
    });
    // Equal case weights: the mean of the case rates, not the pooled trial rate.
    const rates = cases.map((c) => c.values.reduce((a, b) => a + b, 0) / c.values.length);
    expect(result.estimate).toBeCloseTo(rates.reduce((a, b) => a + b, 0) / 8, 14);
  });

  it("takes the score interval when only some cases have one trial", () => {
    const cases = binaryCases([[1], [0, 1], [1, 1], [0], [1, 0, 1]]);
    // Clopper–Pearson needs one trial in every case: asserted not to be reached, so that taking it
    // fails as an assertion, not as its count error.
    expect(() => estimate({ valueType: "binary", cases })).not.toThrow();
    const result = estimate({ valueType: "binary", cases });
    expect(result.interval?.method).toBe("one-arm-stratified-score");
  });

  it("refuses values that do not fit the value type", () => {
    expect(() => estimate({ valueType: "binary", cases: binaryCases([[0.5]]) })).toThrow(
      RangeError,
    );
    expect(() => estimate({ valueType: "score", cases: binaryCases([[1.2]]) })).toThrow(RangeError);
    expect(() =>
      estimate({ valueType: "binary", cases: [{ id: "a", values: [1, 1], planned: 1 }] }),
    ).toThrow(RangeError);
    expect(() => estimate({ valueType: "binary", cases: [...ones(2, 1), ...ones(1, 1)] })).toThrow(
      RangeError,
    );
  });

  it("gives no interval and no estimate when no case has a value", () => {
    const result = estimate({ valueType: "binary", cases: [{ id: "a", values: [], planned: 2 }] });
    expect(result.estimate).toBeNaN();
    expect(result.interval).toBeNull();
    expect(result.noInterval).toBe("NO_VALUES");
    expect(result.worstCase).toEqual({ low: 0, high: 1 });
  });
});

describe("estimate: missing trials", () => {
  const cases: EstimateCase[] = [
    { id: "a", values: [1, 1], planned: 2 },
    { id: "b", values: [1], planned: 2 },
    { id: "c", values: [], planned: 2 },
    { id: "d", values: [0, 1], planned: 2 },
  ];

  it("shows the worst-case bounds over every planned trial", () => {
    const result = estimate({ valueType: "binary", cases });
    // Missing as failure: (1 + 0.5 + 0 + 0.5)/4. Missing as success: (1 + 1 + 1 + 0.5)/4.
    expect(result.worstCase.low).toBeCloseTo(0.5, 14);
    expect(result.worstCase.high).toBeCloseTo(0.875, 14);
    expect(result.cases).toBe(3);
    expect(result.missingCases).toBe(1);
  });

  it("gives the operational estimand Clopper–Pearson over planned trials, missing as failure", () => {
    const result = estimate({ valueType: "binary", cases });
    const reference = clopperPearson({ successes: 4, trials: 8 });
    expect(result.operational).toMatchObject({
      estimate: 0.5,
      lower: reference.lower,
      upper: reference.upper,
      method: "clopper-pearson",
      coverage: "conservative",
    });
  });

  it("uses Hoeffding's bound for the operational estimand of scores", () => {
    const input = {
      valueType: "score" as const,
      cases: [
        { id: "a", values: [0.5, 0.25], planned: 2 },
        { id: "b", values: [1], planned: 2 },
      ],
    };
    // Clopper–Pearson cannot take a fractional count: asserted not to be reached.
    expect(() => estimate(input)).not.toThrow();
    const result = estimate(input);
    expect(result.operational.method).toBe("hoeffding");
    expect(result.operational.estimate).toBeCloseTo((0.375 + 0.5) / 2, 14);
  });
});

const cluster = (n: number): EstimateCase[] =>
  Array.from({ length: n }, (_, i): EstimateCase => ({
    id: `c${i}`,
    family: `f${i % n}`,
    values: [i % 3 === 0 ? 1 : 0],
  }));

describe("estimate: the population study", () => {
  const population = { frame: true, rng: createRng(7), resamples: 2000 };

  it("gives no interval below 30 clusters", () => {
    const result = estimate({
      valueType: "binary",
      estimand: "population",
      population,
      cases: cluster(29),
    });
    expect(result.interval).toBeNull();
    expect(result.noInterval).toBe("FEWER_THAN_30_CLUSTERS");
  });

  it("gives no interval without a declared sampling frame", () => {
    const result = estimate({
      valueType: "binary",
      estimand: "population",
      population: { ...population, frame: false },
      cases: cluster(40),
    });
    expect(result.noInterval).toBe("NO_SAMPLING_FRAME");
  });

  it("gives a BCa interval over the top clusters, not validated, with its seed", () => {
    const result = estimate({
      valueType: "binary",
      estimand: "population",
      population,
      cases: cluster(40),
    });
    expect(result.interval).toMatchObject({ method: "bca", coverage: "not-validated" });
    expect(result.interval!.lower).toBeLessThan(result.estimate);
    expect(result.interval!.upper).toBeGreaterThan(result.estimate);
    expect(result.resampling).toEqual({
      algorithm: "mt19937",
      seed: 7,
      resamples: 2000,
      clusters: 40,
    });
  });

  it("counts resampled estimates tied with the estimate as half in z₀", () => {
    // Half the clusters at 0, half at 1: about 14% of the resamples equal 0.5 exactly. Counting
    // ties as half gives z₀ near 0; counting them as not below would give about −0.18.
    const clusters = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, caseMeans: [i % 2] }));
    const result = bcaInterval(clusters, "per-case", createRng(5), 4000);
    expect(result.refusal).toBeUndefined();
    expect(Math.abs(result.z0!)).toBeLessThan(0.06);
  });

  it("needs its generator", () => {
    expect(() =>
      estimate({ valueType: "binary", estimand: "population", cases: cluster(40) }),
    ).toThrow(RangeError);
  });
});
