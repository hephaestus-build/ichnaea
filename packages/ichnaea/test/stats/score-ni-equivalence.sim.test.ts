// Stage 1 of the score non-inferiority study decides "the lower bound is at most θ" on the
// root-finder's own path (`lowerRootAtMost`, through `events` in scripts/stats/score-ni-points.ts),
// without computing the whole bound. This test is the condition for that: on 10,000 tables, half
// drawn from the study's own generators and half built at the boundaries, every setting's decision
// equals a full `lowerRoot` bound compared with θ, at θ anywhere, within 1e-6 of the bound, and
// where Z₁ is within 1e-9 of its target. The tables on which Z₁ is not monotone are counted per
// kind and reported; they are included in the comparison.
import { describe, expect, it } from "vitest";

import { createRng, type Rng } from "../../src/stats/index.ts";
import {
  boundSC,
  scoreBound,
  scoreStatistic,
  scoreTarget,
} from "../../src/stats/score-interval.ts";
import type { CaseScores } from "../../src/stats/score-permutation-core.ts";
import { lowerRootAtMost } from "../../src/stats/solve.ts";
import { events, LEVEL, niCells, SETTINGS } from "../../scripts/stats/score-ni-points.ts";

/** 10,000 in CI; a smaller ICHNAEA_EQUIVALENCE_TABLES is a smoke run only. */
const TABLES = Number(process.env["ICHNAEA_EQUIVALENCE_TABLES"] ?? 10_000);
const GRID = Array.from({ length: 201 }, (_, i) => -0.999 + (1.998 * i) / 200);
const KINDS = ["0/1 values", "one-trial cells", "arms always 1", "unequal counts"] as const;

/** A synthetic boundary table of one kind, with D from 1 to 1,000. */
function boundaryTable(rng: Rng, kind: number): CaseScores[] {
  const k = 1 + Math.floor(rng.uniform() * 40);
  const d = [1, 2, 4, 100, 1000][Math.floor(rng.uniform() * 5)] as number;
  return Array.from({ length: k }, (_, i) => {
    const r = kind === 1 ? 1 : 1 + Math.floor(rng.uniform() * 3);
    const mu = rng.uniform();
    const value = (): number => {
      if (kind === 0) return rng.uniform() < 0.5 ? 0 : 1;
      if (kind === 2 && i % 3 === 0) return 1;
      return Math.round(Math.min(1, Math.max(0, mu + (rng.uniform() - 0.5) * 0.4)) * d) / d;
    };
    return {
      id: `c${i}`,
      candidate: Array.from({ length: r }, value),
      base: Array.from({ length: kind === 3 ? 1 + Math.floor(rng.uniform() * 3) : r }, value),
    };
  });
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const estimateOf = (cases: readonly CaseScores[]): number => {
  const used = cases.filter((c) => c.candidate.length > 0 && c.base.length > 0);
  return used.reduce((a, c) => a + mean(c.candidate) - mean(c.base), 0) / used.length;
};

describe("score non-inferiority: the study's decision equals the root-finder's bound", () => {
  it("agrees with a full lowerRoot on 10,000 tables, for every setting", () => {
    const rng = createRng(70_000_001);
    const points = niCells().flatMap((c) => c.points);
    const failures: string[] = [];
    const nonMonotone: Record<string, number> = { generators: 0 };
    for (const k of KINDS) nonMonotone[k] = 0;
    let fromGenerators = 0;
    let comparisons = 0;
    for (let t = 0; t < TABLES; t++) {
      let cases: CaseScores[];
      let kind: string;
      if (t % 2 === 0) {
        const point = points[Math.floor(rng.uniform() * points.length)] as (typeof points)[number];
        cases = point.draw(rng);
        kind = "generators";
        fromGenerators++;
      } else {
        const k = Math.floor(rng.uniform() * KINDS.length);
        cases = boundaryTable(rng, k);
        kind = KINDS[k] as string;
      }
      const z1 = scoreStatistic(cases);
      for (let g = 1; g < GRID.length; g++)
        if (z1(GRID[g] as number) > z1(GRID[g - 1] as number) + 1e-12) {
          nonMonotone[kind] = (nonMonotone[kind] ?? 0) + 1;
          break;
        }
      for (const [index, setting] of SETTINGS.entries()) {
        if (setting.phi === "t") {
          const bound = boundSC(cases, LEVEL);
          const theta = -rng.uniform() * 0.5;
          if (events(cases, -theta)[index] !== (bound === null || bound <= theta))
            failures.push(`${setting.name} table ${t}`);
          comparisons++;
          continue;
        }
        const phi = setting.phi(cases);
        const bound = scoreBound(cases, LEVEL, phi);
        const target = scoreTarget(LEVEL, phi);
        const thetas = [
          -1 + 2 * rng.uniform(),
          bound + (rng.uniform() - 0.5) * 2e-6,
          bound + 1e-11,
          bound - 1e-11,
          bound,
        ].filter((x) => x >= -1 && x <= 1);
        for (const theta of thetas) {
          if (lowerRootAtMost(z1, target, -1, 1, theta) !== bound <= theta)
            failures.push(`${setting.name} table ${t} (${kind}): θ = ${theta}, bound ${bound}`);
          comparisons++;
        }
        // The harness's own call at a margin just past the bound and just short of it.
        if (bound < -1e-9 && bound > -1 + 1e-9) {
          if (events(cases, -bound - 1e-9)[index] !== true)
            failures.push(`${setting.name} table ${t}: events() at the bound + 1e-9`);
          if (events(cases, -bound + 1e-9)[index] !== false)
            failures.push(`${setting.name} table ${t}: events() at the bound − 1e-9`);
          comparisons += 2;
        }
      }
    }
    console.log(
      [
        `equivalence: ${TABLES} tables (${fromGenerators} from the generators), ${SETTINGS.length} settings, ${comparisons} comparisons, ${failures.length} disagreements`,
        `Z₁ not monotone on: ${Object.entries(nonMonotone)
          .map(([k, n]) => `${k} ${n}`)
          .join(", ")}`,
      ].join("\n"),
    );
    expect(fromGenerators).toBeGreaterThanOrEqual(TABLES / 2);
    expect(failures.slice(0, 20)).toEqual([]);
  }, 3_000_000);

  it("puts the bound at the estimate when φ = 0: the target is 0", () => {
    const rng = createRng(70_000_002);
    for (let t = 0; t < 500; t++) {
      const cases = boundaryTable(rng, t % 4);
      const estimate = estimateOf(cases);
      if (estimate <= -1 + 1e-9) continue;
      expect(Math.abs(scoreBound(cases, LEVEL, 0) - estimate), `table ${t}`).toBeLessThan(1e-12);
    }
  });
});
