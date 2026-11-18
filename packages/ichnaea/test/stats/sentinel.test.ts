import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  exactStratifiedTest,
  sentinelDetectableDrift,
  sentinelMethod,
  sentinelTest,
} from "../../src/stats/index.ts";
import { sentinelPowerExact, sentinelPowerSimulated } from "../../src/stats/sentinel.ts";

interface Direction {
  largest: number;
  caught: boolean;
  drift: number | null;
  power: number;
  grid: { drift: number; power: number }[];
}
const python = JSON.parse(
  readFileSync(new URL("./reference-python-sentinel.json", import.meta.url), "utf8"),
) as {
  readonly settings: readonly {
    cases: number;
    trials: number;
    rate: number;
    down: Direction;
    up: Direction;
  }[];
};

const binomial = (x: number, p: number): number => [1, 2, 1][x]! * p ** x * (1 - p) ** (2 - x);

describe("the sentinel test", () => {
  it("is twice the smaller one-sided exact p-value, at most 1", () => {
    const strata = [
      { candidate: { successes: 0, trials: 2 }, base: { successes: 2, trials: 2 } },
      { candidate: { successes: 1, trials: 2 }, base: { successes: 2, trials: 2 } },
      { candidate: { successes: 0, trials: 2 }, base: { successes: 2, trials: 2 } },
    ];
    const less = exactStratifiedTest(strata, "less").p;
    const result = sentinelTest(strata);
    expect(result.p).toBeCloseTo(2 * less, 15);
    expect(result.drifted).toBe(result.p <= 0.05);
    const none = [{ candidate: { successes: 1, trials: 2 }, base: { successes: 1, trials: 2 } }];
    expect(sentinelTest(none)).toMatchObject({ p: 1, drifted: false });
  });

  it("has the power that the exact sum gives, by enumerating every outcome of 3 cases × 2 trials", () => {
    // Every (stored, fresh) count of every case, weighted by its probability, through sentinelTest.
    for (const [stored, fresh] of [
      [0.8, 0.1],
      [0.5, 0.95],
      [0.3, 0.3],
    ] as const) {
      let power = 0;
      for (let code = 0; code < 9 ** 3; code++) {
        let weight = 1;
        const strata = [0, 1, 2].map((i) => {
          const cell = Math.floor(code / 9 ** i) % 9;
          const x = Math.floor(cell / 3);
          const y = cell % 3;
          weight *= binomial(x, stored) * binomial(y, fresh);
          return { candidate: { successes: y, trials: 2 }, base: { successes: x, trials: 2 } };
        });
        if (sentinelTest(strata, 0.3).drifted) power += weight;
      }
      expect(sentinelPowerExact(3, 2, stored, fresh, 0.3)).toBeCloseTo(power, 13);
    }
  });
});

// Each setting sums C(k + 2r, 2r) vectors of case counts at every drift the search tries, and again
// at every point of the grid it checks: tens of exact evaluations, 8,008 vectors each at 10 cases
// × 3 trials. That is heavier than vitest's default timeout assumes on a loaded runner.
describe(
  "the detectable drift, against an exact rational enumeration in Python",
  { timeout: 30_000 },
  () => {
    it.each(python.settings.map((s) => [`${s.cases} × ${s.trials} at ${s.rate}`, s] as const))(
      "%s",
      (_, s) => {
        const result = sentinelDetectableDrift({ cases: s.cases, trials: s.trials, rate: s.rate });
        expect(result.method).toBe("exact");
        expect(result).not.toHaveProperty("seed");
        for (const [mine, theirs] of [
          [result.down, s.down],
          [result.up, s.up],
        ] as const) {
          expect(mine.caught).toBe(theirs.caught);
          expect(mine.drift).toBe(theirs.drift);
          expect(mine.largest).toBe(theirs.largest);
          expect(mine.power).toBeCloseTo(theirs.power, 12);
        }
        for (const [sign, grid] of [
          [-1, s.down.grid],
          [1, s.up.grid],
        ] as const)
          for (const point of grid)
            expect(
              sentinelPowerExact(s.cases, s.trials, s.rate, s.rate + sign * point.drift),
              `${sign} ${point.drift}`,
            ).toBeCloseTo(point.power, 12);
      },
    );

    it("gives the figures of the ruling at 15 cases × 2 trials", () => {
      const high = sentinelDetectableDrift({ cases: 15, trials: 2, rate: 0.8 });
      // A downward drift of 0.375, rounded up to 0.4; no upward drift reaches 4 in 5: even a drift to
      // 1.0 is caught 63% of the time.
      expect(high.down).toMatchObject({ caught: true, drift: 0.4 });
      expect(high.up).toMatchObject({ caught: false, drift: null });
      expect(high.up.power).toBeCloseTo(0.6286, 4);
      expect(sentinelPowerExact(15, 2, 0.8, 0.425)).toBeCloseTo(0.7995, 4);
      expect(sentinelPowerExact(15, 2, 0.8, 0.45)).toBeLessThan(0.8);
      const half = sentinelDetectableDrift({ cases: 15, trials: 2, rate: 0.5 });
      expect(half.down.drift).toBe(0.4);
      expect(half.up.drift).toBe(0.4);
      expect(sentinelPowerExact(15, 2, 0.5, 0.15)).toBeLessThan(0.8);
    });
  },
);

describe("the simulated detectable drift", () => {
  it("simulates above 10⁵ terms, with 10,000 draws and the seed recorded, and needs a seed", () => {
    // C(30 + 4, 4) = 46,376 terms: exact. C(41 + 4, 4) = 148,995: simulated. At one trial,
    // C(445 + 2, 2) = 99,681 and C(446 + 2, 2) = 100,128.
    expect(sentinelMethod(30, 2)).toBe("exact");
    expect(sentinelMethod(41, 2)).toBe("simulated");
    expect(sentinelMethod(445, 1)).toBe("exact");
    expect(sentinelMethod(446, 1)).toBe("simulated");
    expect(() => sentinelDetectableDrift({ cases: 41, trials: 2, rate: 0.9 })).toThrow(RangeError);
    // At 0.9 the grid is short: 2 upward points and at most 18 downward.
    const result = sentinelDetectableDrift({ cases: 41, trials: 2, rate: 0.9, seed: 11 });
    expect(result).toMatchObject({ method: "simulated", draws: 10_000, seed: 11 });
  }, 60_000);

  it("draws the same uniforms from the same seed at every fresh rate", () => {
    const a = sentinelPowerSimulated(15, 2, 0.8, 0.425, 2000, 9);
    expect(sentinelPowerSimulated(15, 2, 0.8, 0.425, 2000, 9)).toBe(a);
    expect(sentinelPowerSimulated(15, 2, 0.8, 0.425, 2000, 10)).not.toBe(a);
    // The same uniforms at a fresh rate a hair away: no draw crosses, so the power is the same.
    expect(sentinelPowerSimulated(15, 2, 0.8, 0.425 + 1e-9, 2000, 9)).toBe(a);
    // With no drift, the exact test rejects at most at its level.
    expect(sentinelPowerSimulated(15, 2, 0.8, 0.8, 2000, 9)).toBeLessThanOrEqual(0.05 + 0.02);
  });
});

describe("the trials per case", () => {
  it("gives full separation its power of 1 within the limit", () => {
    // Every stored trial passes and every fresh one fails: p = 2/C(2r, r), which rejects.
    expect(sentinelPowerExact(1, 50, 1, 0)).toBe(1);
    expect(sentinelPowerSimulated(1, 50, 1, 0, 10, 1)).toBe(1);
  });

  it("refuses more than 500 in the simulated power, where C(2r, r) overflows from r = 511", () => {
    expect(() => sentinelPowerSimulated(1, 501, 1, 0, 1, 1)).toThrow(RangeError);
  });

  it("refuses more than 500 in the exact power", () => {
    expect(() => sentinelPowerExact(1, 501, 1, 0)).toThrow(RangeError);
  });
});

describe("the inputs of the detectable drift", () => {
  it("refuses an empty sentinel, a rate outside [0, 1] and a target outside (0, 1)", () => {
    expect(() => sentinelDetectableDrift({ cases: 0, trials: 2, rate: 0.5 })).toThrow(RangeError);
    expect(() => sentinelDetectableDrift({ cases: 5, trials: 1.5, rate: 0.5 })).toThrow(RangeError);
    expect(() => sentinelDetectableDrift({ cases: 5, trials: 2, rate: 1.2 })).toThrow(RangeError);
    expect(() => sentinelDetectableDrift({ cases: 5, trials: 2, rate: 0.5, target: 1 })).toThrow(
      RangeError,
    );
  });
});
