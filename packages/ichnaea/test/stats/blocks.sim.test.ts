import { describe, expect, it } from "vitest";

import {
  blockLowerBound,
  bothBoundsClear,
  sharpNullBlockP,
  sharpNullPairP,
  withinRunLowerBound,
} from "../../src/stats/randomized-blocks.ts";
import type { Rng } from "../../src/stats/rng.ts";
import type { Stratum } from "../../src/stats/score-difference.ts";

import { documented } from "./support/documented.ts";
import { judge, type Point, TYPE_I } from "./support/simulate.ts";

const alpha = 0.05;

interface TrialPair {
  readonly early: number;
  readonly late: number;
}

function assignment(pairs: readonly TrialPair[], cases: number, rng: Rng) {
  const blocks = Array.from({ length: pairs.length / cases }, () => ({
    pairs: cases,
    numerator: 0,
  }));
  let negative = 0;
  let positive = 0;
  pairs.forEach(({ early, late }, index) => {
    const difference = (rng.uniform() < 0.5 ? 1 : -1) * (late - early);
    blocks[Math.floor(index / cases)]!.numerator += difference;
    negative += Number(difference < 0);
    positive += Number(difference > 0);
  });
  return { block: sharpNullBlockP(blocks), within: sharpNullPairP(negative, positive) };
}

function nullPairs(
  blocks: number,
  cases: number,
  structure: "linear drift" | "skew" | "different centres",
  rng: Rng,
): TrialPair[] {
  const length = blocks * cases;
  return Array.from({ length }, (_, i) => {
    const block = Math.floor(i / cases);
    if (structure === "linear drift") {
      // The latent time effect crosses each case's threshold between its two adjacent slots.
      // Every pair is discordant, so a shared block draw would reject half of one-block runs.
      const before = (2 * i) / (2 * length);
      const after = (2 * i + 1) / (2 * length);
      const threshold = (before + after) / 2;
      return { early: Number(before > threshold), late: Number(after > threshold) };
    }
    if (structure === "skew") {
      const shared = rng.uniform() < 0.9;
      return { early: Number(shared), late: Number(!shared) };
    }
    const p = block % 2 === 0 ? 0.2 : 0.85;
    return { early: Number(rng.uniform() < p), late: Number(rng.uniform() < 1 - p) };
  });
}

function passAtBoundary(
  cases: number,
  blocks: number,
  margin: number,
  structure: "ceiling" | "heterogeneous",
  rng: Rng,
): boolean {
  const contrasts = Array.from({ length: blocks }, () => ({ pairs: cases, numerator: 0 }));
  const strata: Stratum[] = [];
  for (const block of contrasts) {
    for (let i = 0; i < cases; i++) {
      const p = structure === "ceiling" ? 1 : 0.6 + (0.3 * i) / (cases - 1);
      const q = structure === "ceiling" ? 1 - margin : p - margin + (i % 2 === 0 ? 0.02 : -0.02);
      const base = Number(rng.uniform() < p);
      const candidate = Number(rng.uniform() < q);
      block.numerator += candidate - base;
      strata.push({
        base: { successes: base, trials: 1 },
        candidate: { successes: candidate, trials: 1 },
      });
    }
  }
  const block = blockLowerBound(contrasts, alpha);
  if (!(block > -margin)) return false;
  return bothBoundsClear(block, withinRunLowerBound(strata, alpha), margin);
}

describe("randomized blocks", () => {
  it("controls sharp-null error with a coin null, linear drift, skew and different centres", () => {
    const points: Point[] = [];
    let seed = 2400;
    for (let blocks = 1; blocks <= 8; blocks++) {
      // One coin per block where all the observed pair differences share its sign.
      let rejected = 0;
      const patterns = 2 ** blocks;
      for (let signs = 0; signs < patterns; signs++) {
        const evidence = Array.from({ length: blocks }, (_, i) => ({
          pairs: 20,
          numerator: signs & (1 << i) ? 20 : -20,
        }));
        rejected += Number(sharpNullBlockP(evidence) <= alpha);
      }
      points.push({ label: `coin null R=${blocks}`, seed: 0, exact: rejected / patterns });
    }
    for (const R of [1, 5, 8]) {
      for (const source of ["linear drift", "skew", "different centres"] as const) {
        for (const method of ["block", "within"] as const) {
          points.push({
            label: `${source} R=${R} ${method}`,
            seed: seed++,
            run: (rng) => assignment(nullPairs(R, 20, source, rng), 20, rng)[method] <= alpha,
          });
        }
      }
    }
    const verdict = judge(points, TYPE_I, "randomized blocks and pairs under the sharp null");
    expect(verdict.failures).toEqual([]);
    const { run, page } = documented(TYPE_I, verdict);
    expect(run).toEqual(page);
  });

  it("searches for margins whose boundary clears the joint PASS gate", () => {
    const points: Point[] = [];
    let seed = 2600;
    for (const cases of [20, 60, 72]) {
      for (const blocks of [5, 6, 7, 8]) {
        for (const margin of [0.06, 0.1, 0.15]) {
          for (const structure of ["ceiling", "heterogeneous"] as const)
            points.push({
              label: `${structure} n=${cases} R=${blocks} m=${margin}`,
              seed: seed++,
              run: (rng) => passAtBoundary(cases, blocks, margin, structure, rng),
            });
        }
      }
    }
    const verdict = judge(points, TYPE_I, "joint PASS boundary and margin search");
    expect(verdict.failures).toEqual([]);
    const { run, page } = documented(TYPE_I, verdict);
    expect(run).toEqual(page);
  });
  it("measures false Pass under full-block shocks outside the common-shift model", () => {
    const points: Point[] = [];
    for (const { label, bases, falls } of [
      { label: "skewed shocks", bases: [19, 19, 19, 19, 19], falls: [19, 19, 19, 19, 19] },
      { label: "different centres", bases: [20, 16, 20, 16, 20], falls: [20, 12, 20, 12, 20] },
    ]) {
      const cases = 20;
      const blocks = bases.length;
      const margin = 0.1;
      const shock = (margin * cases * blocks) / falls.reduce((sum, n) => sum + n, 0);
      let falsePass = 0;
      for (let mask = 0; mask < 2 ** blocks; mask++) {
        let probability = 1;
        const strata: Stratum[] = [];
        const contrasts = bases.map((base, b) => {
          const unfavourable = Boolean(mask & (1 << b));
          const candidate = unfavourable ? base - falls[b]! : base;
          probability *= unfavourable ? shock : 1 - shock;
          for (let i = 0; i < cases; i++)
            strata.push({
              base: { successes: Number(i < base), trials: 1 },
              candidate: { successes: Number(i < candidate), trials: 1 },
            });
          return { numerator: candidate - base, pairs: cases };
        });
        if (
          bothBoundsClear(
            blockLowerBound(contrasts, alpha),
            withinRunLowerBound(strata, alpha),
            margin,
          )
        )
          falsePass += probability;
      }
      points.push({ label, seed: 0, exact: falsePass });
    }
    const verdict = judge(points, TYPE_I, "block shocks outside PASS model (must fail)");
    expect(verdict.failures).toHaveLength(points.length);
    const { run, page } = documented(TYPE_I, verdict);
    expect(run).toEqual(page);
  });
});
