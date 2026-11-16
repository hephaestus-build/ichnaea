// The work limit of the score permutation test's exact path, timed on the machine that runs the
// simulation job (VALIDATION.md, "Score measures: the regression test"). For each shape, the
// largest table whose work estimate W is within SCORE_PERMUTATION_WORK_LIMIT runs exactly; the run
// prints its time, and fails if any takes more than 3 seconds. The limit aims at about 1 second.
import { describe, expect, it } from "vitest";

import { createRng, type Rng, scorePermutationTest } from "../../src/stats/index.ts";
import { type CaseScores, exactWork } from "../../src/stats/score-permutation-core.ts";
import { SCORE_PERMUTATION_WORK_LIMIT } from "../../src/stats/score-permutation.ts";

const value = (rng: Rng, d: number): number => Math.round(rng.uniform() * d) / d;

/** k cases of r trials per arm with values on the lattice of step 1/d, from one seed. */
const shape =
  (r: number, d: number, seed: number) =>
  (k: number): CaseScores[] => {
    const rng = createRng(seed);
    return Array.from({ length: k }, (_, i) => ({
      id: `c${i}`,
      candidate: Array.from({ length: r }, () => value(rng, d)),
      base: Array.from({ length: r }, () => value(rng, d)),
    }));
  };

const SHAPES: readonly [string, (k: number) => CaseScores[]][] = [
  ["3-decimal scores, 3 trials", shape(3, 1000, 11)],
  ["3-decimal scores, 2 trials", shape(2, 1000, 12)],
  ["3-decimal scores, 1 trial", shape(1, 1000, 13)],
  ["2-decimal scores, 3 trials", shape(3, 100, 14)],
  ["3-decimal scores, 9 trials", shape(9, 1000, 15)],
];

describe("score permutation test: the exact path at its work limit", () => {
  it("runs each shape's largest exact table within 3 seconds", () => {
    const rows: string[] = [];
    for (const [name, make] of SHAPES) {
      let k = 1;
      while ((exactWork(make(k + 1)) ?? Infinity) <= SCORE_PERMUTATION_WORK_LIMIT) k++;
      const table = make(k);
      const start = performance.now();
      const result = scorePermutationTest(table);
      const seconds = (performance.now() - start) / 1000;
      expect(result.method).toBe("within-case-permutation-exact");
      rows.push(`  ${seconds.toFixed(3)} s  W = ${result.work}  k = ${k}  ${name}`);
      expect(seconds, name).toBeLessThan(3);
    }
    console.log(
      [`\nexact path at the work limit W ≤ ${SCORE_PERMUTATION_WORK_LIMIT}:`, ...rows].join("\n"),
    );
  }, 300_000);
});
