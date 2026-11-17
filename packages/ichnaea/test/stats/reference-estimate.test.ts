import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  bcaInterval,
  clopperPearson,
  createRng,
  kaplanMeier,
  missingDifferenceTest,
  oneArmScoreInterval,
  reduceTrials,
  restrictedMean,
  type Sided,
  survivalQuantile,
  type Weighting,
} from "../../src/stats/index.ts";

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));

interface RReference {
  readonly clopperPearson: readonly {
    successes: number;
    trials: number;
    level: number;
    two: [number, number];
    lower: number;
    upper: number;
  }[];
  readonly kaplanMeier: readonly {
    name: string;
    time: number[];
    censored: boolean[];
    weight: number[];
    limit: number;
    steps: { time: number[]; atRisk: number[]; events: number[]; survival: number[] };
    probs: number[];
    quantiles: (number | null)[];
    rmean: number;
  }[];
  readonly missing: readonly {
    base: number[];
    candidate: number[];
    planned: number[];
    less: number;
    greater: number;
  }[];
}

interface PythonReference {
  readonly oneArmScore: readonly {
    name: string;
    cells: { sum: number; trials: number; weight: number }[];
    level: number;
    sided: Sided;
    bounds: [number, number];
  }[];
  readonly clopperPearson: readonly {
    successes: number;
    trials: number;
    level: number;
    two: [number, number];
  }[];
  readonly bca: readonly {
    name: string;
    clusters: { id: string; caseMeans: number[] }[];
    weighting: Weighting;
    seed: number;
    resamples: number;
    level: number;
    estimate: number;
    lower: number;
    upper: number;
    z0: number;
    acceleration: number;
  }[];
  readonly reductions: readonly { values: number[]; k: number; all: number; any: number }[];
}

const r = read("./reference-r-estimate.json") as RReference;
const python = read("./reference-python-estimate.json") as PythonReference;

describe("Clopper–Pearson against R's binom.test and mpmath", () => {
  it("agrees with binom.test within 1e-12 on every count, level and side", () => {
    expect(r.clopperPearson.length).toBeGreaterThanOrEqual(51);
    for (const c of r.clopperPearson) {
      const count = { successes: c.successes, trials: c.trials };
      const label = `${c.successes}/${c.trials} at ${c.level}`;
      const two = clopperPearson(count, c.level);
      expect(two.lower, label).toBeCloseTo(c.two[0], 12);
      expect(two.upper, label).toBeCloseTo(c.two[1], 12);
      expect(clopperPearson(count, c.level, "lower").lower, label).toBeCloseTo(c.lower, 12);
      expect(clopperPearson(count, c.level, "upper").upper, label).toBeCloseTo(c.upper, 12);
    }
  });

  it("agrees with mpmath's incomplete beta within 1e-12", () => {
    for (const c of python.clopperPearson) {
      const two = clopperPearson({ successes: c.successes, trials: c.trials }, c.level);
      expect(two.lower).toBeCloseTo(c.two[0], 12);
      expect(two.upper).toBeCloseTo(c.two[1], 12);
    }
  });
});

describe("the one-arm stratified score interval against an independent Python implementation", () => {
  it("agrees within 1e-9 on every fixture, level and side", () => {
    expect(python.oneArmScore.length).toBe(36);
    for (const f of python.oneArmScore) {
      const interval = oneArmScoreInterval(f.cells, f.level, f.sided);
      const label = `${f.name} ${f.level} ${f.sided}`;
      expect(Math.abs(interval.lower - f.bounds[0]), label).toBeLessThan(1e-9);
      expect(Math.abs(interval.upper - f.bounds[1]), label).toBeLessThan(1e-9);
    }
  });
});

describe("BCa against an independent Python implementation on numpy's MT19937 draws", () => {
  it("agrees within 1e-12 on the estimate, both bounds, z₀ and the acceleration", () => {
    expect(python.bca.length).toBe(4);
    for (const f of python.bca) {
      const result = bcaInterval(f.clusters, f.weighting, createRng(f.seed), f.resamples, f.level);
      expect(result.interval, f.name).toBeDefined();
      expect(result.interval!.estimate, f.name).toBeCloseTo(f.estimate, 12);
      expect(result.interval!.lower, f.name).toBeCloseTo(f.lower, 12);
      expect(result.interval!.upper, f.name).toBeCloseTo(f.upper, 12);
      expect(result.z0, f.name).toBeCloseTo(f.z0, 12);
      expect(result.acceleration, f.name).toBeCloseTo(f.acceleration, 12);
    }
  });
});

describe("pass^k and pass@k against exact rational arithmetic", () => {
  it("agrees within 1e-15", () => {
    for (const f of python.reductions) {
      expect(reduceTrials(f.values, { all: { k: f.k } })).toBeCloseTo(f.all, 15);
      expect(reduceTrials(f.values, { any: { k: f.k } })).toBeCloseTo(f.any, 15);
    }
  });
});

describe("Kaplan–Meier against R's survival::survfit", () => {
  it("agrees on the curve, the quantiles and the restricted mean", () => {
    expect(r.kaplanMeier.length).toBe(4);
    for (const s of r.kaplanMeier) {
      const sample = s.time.map((time, i) => ({
        time,
        censored: s.censored[i]!,
        weight: s.weight[i]!,
      }));
      const steps = kaplanMeier(sample);
      expect(
        steps.map((x) => x.time),
        s.name,
      ).toEqual(s.steps.time);
      steps.forEach((step, i) => {
        expect(step.atRisk, s.name).toBeCloseTo(s.steps.atRisk[i]!, 12);
        expect(step.events, s.name).toBeCloseTo(s.steps.events[i]!, 12);
        expect(step.survival, s.name).toBeCloseTo(s.steps.survival[i]!, 12);
      });
      s.probs.forEach((q, i) => {
        const expected = s.quantiles[i];
        const result = survivalQuantile(sample, q);
        const label = `${s.name} q=${q}`;
        if (s.name === "all-censored-late" && q === 0.4) {
          // The one documented difference: the curve sits on 1 − q from 2 to the last time, 5. R
          // takes the midpoint, 3.5; the curve beyond 5 is unknown, so Ichnaea says "at least 2".
          expect(expected, label).toBe(3.5);
          expect(result, label).toEqual({ atLeast: 2 });
        } else if (expected === null) expect(result, label).toHaveProperty("atLeast");
        else expect(result, label).toEqual({ value: expected });
      });
      expect(restrictedMean(sample, s.limit), s.name).toBeCloseTo(s.rmean, 12);
    }
  });
});

describe("the missing-count test against R's exact mantelhaen.test", () => {
  it("is twice the smaller one-sided p-value", () => {
    for (const t of r.missing) {
      const cases = t.planned.map((planned, i) => ({
        base: { missing: t.base[i]!, planned },
        candidate: { missing: t.candidate[i]!, planned },
      }));
      expect(missingDifferenceTest(cases).p).toBeCloseTo(
        Math.min(1, 2 * Math.min(t.less, t.greater)),
        12,
      );
    }
  });
});
