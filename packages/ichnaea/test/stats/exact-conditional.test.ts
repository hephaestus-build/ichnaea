import { describe, expect, it } from "vitest";

import { exactStratifiedTest } from "../../src/stats/exact-conditional.ts";
import { createRng } from "../../src/stats/rng.ts";
import type { Stratum } from "../../src/stats/score-difference.ts";

const logFactorial = (n: number): number => {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
};
const logChoose = (n: number, k: number): number =>
  logFactorial(n) - logFactorial(k) - logFactorial(n - k);

/** The test before strata with one feasible count were kept as an offset: every stratum convolved. */
function convolvingEveryStratum(strata: readonly Stratum[], alternative: "less" | "greater") {
  let distribution = [1];
  let observed = 0;
  for (const s of strata) {
    const n1 = s.candidate.trials;
    const n2 = s.base.trials;
    if (n1 === 0 || n2 === 0) continue;
    const total = s.candidate.successes + s.base.successes;
    observed += s.candidate.successes;
    const lo = Math.max(0, total - n2);
    const hi = Math.min(n1, total);
    const denominator = logChoose(n1 + n2, total);
    const pmf: number[] = [];
    for (let k = 0; k <= hi; k++)
      pmf.push(k < lo ? 0 : Math.exp(logChoose(n1, k) + logChoose(n2, total - k) - denominator));
    const next = Array.from({ length: distribution.length + pmf.length - 1 }, () => 0);
    distribution.forEach((a, i) => pmf.forEach((b, j) => (next[i + j] = next[i + j]! + a * b)));
    distribution = next;
  }
  let p = 0;
  distribution.forEach((mass, t) => {
    if (alternative === "less" ? t <= observed : t >= observed) p += mass;
  });
  return { statistic: observed, p: Math.min(1, p) };
}

describe("the exact stratified conditional test", () => {
  it("gives bit for bit the same p-value and statistic when strata with one feasible count shift", () => {
    const rng = createRng(29);
    const draw = (n: number) => Math.floor(rng.uniform() * (n + 1));
    for (let table = 0; table < 300; table++) {
      const strata: Stratum[] = Array.from({ length: 1 + Math.floor(rng.uniform() * 40) }, () => {
        const n1 = 1 + Math.floor(rng.uniform() * 3);
        const n2 = 1 + Math.floor(rng.uniform() * 3);
        // Half the strata are fixed: none or all of their trials succeeded.
        const kind = rng.uniform();
        if (kind < 0.25)
          return { candidate: { successes: 0, trials: n1 }, base: { successes: 0, trials: n2 } };
        if (kind < 0.5)
          return { candidate: { successes: n1, trials: n1 }, base: { successes: n2, trials: n2 } };
        return {
          candidate: { successes: draw(n1), trials: n1 },
          base: { successes: draw(n2), trials: n2 },
        };
      });
      for (const alternative of ["less", "greater"] as const) {
        const now = exactStratifiedTest(strata, alternative);
        const before = convolvingEveryStratum(strata, alternative);
        expect(now.p, `table ${table} ${alternative}`).toBe(before.p);
        expect(now.statistic).toBe(before.statistic);
      }
    }
  });

  it("handles ten thousand strata that all have one feasible count", () => {
    const fixed: Stratum[] = Array.from({ length: 10_000 }, (_, i) => ({
      candidate: { successes: i % 2 === 0 ? 0 : 2, trials: 2 },
      base: { successes: i % 2 === 0 ? 0 : 3, trials: 3 },
    }));
    expect(exactStratifiedTest(fixed, "less")).toMatchObject({ statistic: 10_000, p: 1 });
    expect(exactStratifiedTest(fixed, "greater")).toMatchObject({ statistic: 10_000, p: 1 });
  });
});
