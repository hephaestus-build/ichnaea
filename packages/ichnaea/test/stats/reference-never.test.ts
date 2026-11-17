import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { chiSquareQuantile, intraclassCorrelation, stratifiedZ } from "../../src/stats/index.ts";

const r = JSON.parse(
  readFileSync(new URL("./reference-r-estimate.json", import.meta.url), "utf8"),
) as {
  readonly mantelHaenszel: readonly {
    candidate: number[];
    cn: number[];
    base: number[];
    bn: number[];
    z2: number;
  }[];
  readonly chiSquare: readonly { df: number; p: number; q: number }[];
  readonly intraclass: readonly { clusters: number[][]; rho: number }[];
};

describe("the overdispersion z against R", () => {
  it("squares to R's uncorrected Mantel–Haenszel statistic", () => {
    expect(r.mantelHaenszel.length).toBe(3);
    for (const run of r.mantelHaenszel) {
      const strata = run.cn.map((cn, i) => ({
        candidate: { successes: run.candidate[i]!, trials: cn },
        base: { successes: run.base[i]!, trials: run.bn[i]! },
      }));
      expect(stratifiedZ(strata)!.z ** 2).toBeCloseTo(run.z2, 12);
    }
  });

  it("uses χ² quantiles that agree with qchisq within 1e-10", () => {
    expect(r.chiSquare.length).toBe(35);
    for (const c of r.chiSquare)
      expect(Math.abs(chiSquareQuantile(c.p, c.df) - c.q) / c.q, `${c.df} ${c.p}`).toBeLessThan(
        1e-10,
      );
  });
});

describe("the intraclass correlation against R's aov", () => {
  it("agrees within 1e-12, with a negative estimate at 0", () => {
    expect(r.intraclass.length).toBe(3);
    for (const set of r.intraclass)
      expect(intraclassCorrelation(set.clusters)).toBeCloseTo(
        Math.min(1, Math.max(0, set.rho)),
        12,
      );
  });
});
