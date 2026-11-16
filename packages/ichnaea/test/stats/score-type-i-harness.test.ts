// The type-I study's harness (scripts/score-type-i-points.ts): its points and seeds follow the rule
// fixed before the study runs (VALIDATION.md, "The type-I study"), and a refinement step can be
// rebuilt for the re-check from what the screening output stores.
import { describe, expect, it } from "vitest";

import { createRng } from "../../src/stats/index.ts";

import {
  cells,
  G2_REFINE_STEPS,
  G2_REFINE_WORST,
  G2_STRUCTURES,
  g2Seeds,
  holm,
  HOLM_REPS,
  nonG2Seeds,
  pointById,
  shardOf,
  structurePoint,
} from "../../scripts/stats/score-type-i-points.ts";
import { LEVELS, STUDY_RESAMPLES } from "../../scripts/stats/score-type-i-rule.ts";

const all = cells();
const points = all.flatMap((c) => c.points);
const g2Cells = all.filter((c) => (c.points[0] as (typeof points)[number]).generator === 2);
const cPrimeOf = (seed: number): number => Math.floor((seed - 10_000_000) / 1_000);

/** Every refinement step's seeds, for every structure index the hill-climb may use. */
const refinementSeeds = g2Cells
  .filter((c) => c.refine !== undefined)
  .flatMap((c) => {
    const cPrime = cPrimeOf((c.points[0] as (typeof points)[number]).seed);
    return Array.from({ length: G2_REFINE_WORST * G2_REFINE_STEPS }, (_, t) =>
      g2Seeds(cPrime, G2_STRUCTURES + t),
    );
  });

describe("score type-I study: points and seeds", () => {
  it("follows the seed formulas exactly", () => {
    for (const p of points)
      if (p.generator === 2) {
        const s = p.seed % 1_000;
        const cPrime = (p.seed - 10_000_000 - s) / 1_000;
        expect(Number(/\/s(\d+)$/.exec(p.id)?.[1])).toBe(s);
        expect(p.seed).toBe(10_000_000 + 1_000 * cPrime + s);
        expect(p.confirmSeed).toBe(20_000_000 + 1_000 * cPrime + s);
        expect(p.recheckSeed).toBe(25_000_000 + 1_000 * cPrime + s);
      } else {
        const c = p.seed - 2_000_000 - 1_000 * p.generator;
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThan(1_000);
        expect(p.confirmSeed).toBe(3_000_000 + 1_000 * p.generator + c);
        expect(p.recheckSeed).toBe(4_000_000 + 1_000 * p.generator + c);
      }
    // Each G2 cell has one c′, the cells take 0, 1, 2, … in order, and the structure stream is
    // 2,002,000 + c′.
    const cPrimes = g2Cells.map((cell) => {
      const own = new Set(cell.points.map((p) => cPrimeOf(p.seed)));
      expect(own.size).toBe(1);
      const cPrime = [...own][0] as number;
      if (cell.structureSeed !== undefined) expect(cell.structureSeed).toBe(2_002_000 + cPrime);
      return cPrime;
    });
    expect(cPrimes).toEqual(cPrimes.map((_c, i) => i));
    expect(g2Cells).toHaveLength(307);
  });

  it("gives every point, refinement step and structure stream its own seed", () => {
    const seeds = [
      ...points.flatMap((p) => [p.seed, p.confirmSeed, p.recheckSeed]),
      ...refinementSeeds.flatMap((x) => [x.seed, x.confirmSeed, x.recheckSeed]),
      ...g2Cells.flatMap((c) => (c.structureSeed === undefined ? [] : [c.structureSeed])),
    ];
    expect(new Set(seeds).size).toBe(seeds.length);
    expect(new Set(points.map((p) => p.id)).size).toBe(points.length);
    // Every seed stays below the non-inferiority study's block, which starts at 30,000,000.
    expect(seeds.every((seed) => seed < 30_000_000)).toBe(true);
  });

  it("asserts the bounds that keep the ranges apart", () => {
    expect(() => g2Seeds(1_000, 0)).toThrow(RangeError);
    expect(() => g2Seeds(0, 1_000)).toThrow(RangeError);
    expect(() => nonG2Seeds(3, 1_000)).toThrow(RangeError);
    expect(g2Seeds(999, 999).recheckSeed).toBe(25_999_999);
    expect(nonG2Seeds(11, 999).recheckSeed).toBe(4_011_999);
    expect(() =>
      structurePoint(0, 1_000, "top", { k: 5, pattern: "r2" }, 10, [[0.5, 0.5]]),
    ).toThrow(RangeError);
    expect(() =>
      structurePoint(1_000, 0, "top", { k: 5, pattern: "r2" }, 10, [[0.5, 0.5]]),
    ).toThrow(RangeError);
  });

  it("has the grid of one trial per case, the reported points and the must-fail checks", () => {
    const r1 = new Set(
      points.filter((p) => p.shape.pattern === "r1" && p.role === "type-I").map((p) => p.shape.k),
    );
    expect([...r1].toSorted((a, b) => a - b)).toEqual([12, 17, 20, 30, 60, 100, 146, 200, 300]);
    expect(
      new Set(
        points
          .filter((p) => p.shape.pattern === "r1" && p.role === "reported" && p.generator === 2)
          .map((p) => p.shape.k),
      ),
    ).toEqual(new Set([5, 8, 10]));
    expect(points.filter((p) => p.role === "must-fail").map((p) => p.test)).toEqual(
      expect.arrayContaining(["binary-items", "permutation", "wald", "paired-t"]),
    );
  });

  it("runs separate shocks at one trial per case as reported points that never count", () => {
    const separate = points.filter(
      (p) => p.generator === 4 && p.shape.pattern === "r1" && p.family.endsWith("-separate"),
    );
    expect(separate.map((p) => `${p.family}/${p.shape.k}`).toSorted()).toEqual(
      [0.01, 0.02, 0.05, 0.1]
        .flatMap((s) =>
          [12, 17, 20, 30, 60, 100, 146, 200, 300].map((k) => `sigma${s}-separate/${k}`),
        )
        .toSorted(),
    );
    for (const p of separate) {
      expect(p.role).toBe("reported");
      expect(p.test).toBe("permutation");
    }
  });

  it("puts every cell in exactly one shard", () => {
    const owned = Array.from({ length: 7 }, (_, i) => shardOf(all, i, 7).map((c) => c.id)).flat();
    expect(owned.toSorted()).toEqual(all.map((c) => c.id).toSorted());
  });

  it("refines by single steps inside the cell's 100 refinement seeds", () => {
    const cell = all.find((c) => c.refine !== undefined) as (typeof all)[number];
    const from = cell.points[0] as (typeof points)[number];
    expect(() => cell.refine?.(from, G2_STRUCTURES - 1)).toThrow(RangeError);
    expect(() => cell.refine?.(from, G2_STRUCTURES + 100)).toThrow(RangeError);
    let step: (typeof points)[number] | undefined;
    for (let s = G2_STRUCTURES; step === undefined && s < G2_STRUCTURES + 100; s++)
      step = cell.refine?.(from, s);
    expect(step?.id).toMatch(/\/s5\d\d$/);
    // The perturbation keeps the true mean difference at 0.
    const structure = JSON.parse(step?.params["structure"] as string) as [number, number][];
    expect(Math.abs(structure.reduce((a, [b, c]) => a + c - b, 0))).toBeLessThan(1e-12);
  });

  it("rebuilds a refinement step from its stored structure, with the seeds the screen used", () => {
    const cell = all.find((c) => c.refine !== undefined) as (typeof all)[number];
    let step: (typeof points)[number] | undefined;
    for (let s = G2_STRUCTURES; step === undefined; s++)
      step = cell.refine?.(cell.points[2] as (typeof points)[number], s);
    const byCell = new Map(all.map((c) => [c.id, c]));
    const rebuilt = pointById(byCell, step.id, step.params["structure"] as string);
    expect([rebuilt.seed, rebuilt.confirmSeed, rebuilt.recheckSeed]).toEqual([
      step.seed,
      step.confirmSeed,
      step.recheckSeed,
    ]);
    expect(rebuilt.params).toEqual(step.params);
    expect(pointById(byCell, (cell.points[3] as (typeof points)[number]).id, undefined)).toBe(
      cell.points[3],
    );
    // The stored structure is exact, so the rebuilt step draws what the step drew, seed for seed.
    const drawn = (pt: typeof rebuilt): unknown[] => {
      const rng = createRng(pt.seed);
      return Array.from({ length: 3 }, () => pt.draw(rng));
    };
    expect(drawn(rebuilt)).toEqual(drawn(step));
  });

  it("finds every G2 point by its ID, a symmetric one too", () => {
    const byCell = new Map(all.map((c) => [c.id, c]));
    const symmetric = points.filter((p) => p.family.startsWith("symmetric"));
    expect(symmetric.length).toBeGreaterThan(0);
    for (const p of symmetric)
      expect(pointById(byCell, p.id, p.params["structure"] as string)).toBe(p);
    for (const p of points.filter((x) => x.generator === 2).slice(0, 2000))
      expect(pointById(byCell, p.id, p.params["structure"] as string)).toBe(p);
  });
});

describe("score type-I study: the Holm levels", () => {
  it("uses a resample count whose test is exact at every level", () => {
    expect(LEVELS).toEqual([0.05, 0.025, 0.05 / 3, 0.0125]);
    for (const level of LEVELS) {
      const slots = (1 + STUDY_RESAMPLES) * level;
      expect(Math.abs(slots - Math.round(slots))).toBeLessThan(1e-9);
    }
  });

  it("runs six reported Holm cells of four correlated measures, at 20,000 repetitions", () => {
    const cellsOfHolm = points.filter((p) => p.test === "holm");
    expect(cellsOfHolm).toHaveLength(6);
    expect(new Set(cellsOfHolm.map((p) => (p.family.startsWith("holm-m") ? "G5" : "G2")))).toEqual(
      new Set(["G2", "G5"]),
    );
    for (const p of cellsOfHolm) {
      expect(p.generator).toBe(11);
      expect(p.role).toBe("reported");
      expect(p.reps).toBe(HOLM_REPS);
      expect(p.recheck).toBe(false);
      const data = p.draw(createRng(p.seed));
      expect(data).toHaveLength(4 * p.shape.k);
      for (let j = 0; j < 4; j++)
        expect(data.filter((c) => c.id.startsWith(`m${j}/`))).toHaveLength(p.shape.k);
    }
  });

  it("rejects the family at a level exactly when the smallest p is at most level/4", () => {
    // Four identical measures with every case a clear drop: the smallest p is far below 0.0125.
    const drop = Array.from({ length: 12 }, (_, i) => ({ candidate: [0, 0], base: [1, 1], i }));
    const data = [0, 1, 2, 3].flatMap((j) =>
      drop.map((c) => ({ id: `m${j}/c${c.i}`, candidate: c.candidate, base: c.base })),
    );
    const r = holm(data, createRng(1));
    expect(r.levels).toEqual([true, true, true, true]);
    expect(r.measures).toEqual([true, true, true, true]);
    // No difference anywhere: the exact test gives p = 1 and nothing rejects.
    const flat = data.map((c) => ({ ...c, candidate: [0.5, 0.5], base: [0.5, 0.5] }));
    expect(holm(flat, createRng(1)).levels).toEqual([false, false, false, false]);
  });
});
