// The type-I study's harness (scripts/score-type-i-points.ts): its points and seeds follow the rule
// fixed before the study runs (VALIDATION.md, "The type-I study"), and a refinement step can be
// rebuilt for the re-check from what the screening output stores.
import { describe, expect, it } from "vitest";

import {
  cells,
  G2_STRUCTURES,
  pointById,
  R1_CASE_COUNTS,
  shardOf,
  structurePoint,
} from "../../scripts/stats/score-type-i-points.ts";

const all = cells();
const points = all.flatMap((c) => c.points);

describe("score type-I study: points and seeds", () => {
  it("gives every point its own screening, confirmation and re-check seed", () => {
    const seeds = points.flatMap((p) => [p.seed, p.confirmSeed, p.recheckSeed]);
    expect(new Set(seeds).size).toBe(seeds.length);
    expect(new Set(points.map((p) => p.id)).size).toBe(points.length);
  });

  it("keeps every seed out of the non-inferiority study's block, 30,000,000 to 99,999,999", () => {
    for (const p of points)
      for (const seed of [p.seed, p.confirmSeed, p.recheckSeed])
        expect(seed).toBeLessThan(30_000_000);
  });

  it("keeps every generator's cells below 1,000 and every G2 structure below 1,000 per cell", () => {
    for (const p of points) {
      if (p.generator === 2) {
        const structure = Number(/\/s(\d+)$/.exec(p.id)?.[1]);
        expect(structure).toBeLessThan(1_000);
        expect((p.seed - 10_000_000) % 1_000).toBe(structure);
        expect(p.confirmSeed - p.seed).toBe(10_000_000);
      } else {
        expect(p.seed - 2_000_000 - 1_000 * p.generator).toBeLessThan(1_000);
        expect(p.confirmSeed - p.seed).toBe(1_000_000);
      }
    }
    expect(() =>
      structurePoint(0, 1_000, "top", { k: 5, pattern: "r2" }, 10, [[0.5, 0.5]]),
    ).toThrow(RangeError);
  });

  it("has the grid of one trial per case, the reported points and the must-fail checks", () => {
    const r1 = new Set(
      points.filter((p) => p.shape.pattern === "r1" && p.role === "type-I").map((p) => p.shape.k),
    );
    expect([...r1].toSorted((a, b) => a - b)).toEqual([...R1_CASE_COUNTS]);
    expect(
      new Set(
        points
          .filter((p) => p.shape.pattern === "r1" && p.role === "reported")
          .map((p) => p.shape.k),
      ),
    ).toEqual(new Set([5, 8, 10]));
    expect(points.filter((p) => p.role === "must-fail").map((p) => p.test)).toEqual(
      expect.arrayContaining(["binary-items", "permutation", "wald", "paired-t"]),
    );
    // Separate shocks at one trial per case cannot be told apart from an effect: none run.
    expect(
      points.some(
        (p) => p.shape.pattern === "r1" && p.family.includes("separate") && p.role !== "must-fail",
      ),
    ).toBe(false);
  });

  it("puts every cell in exactly one shard", () => {
    const owned = Array.from({ length: 7 }, (_, i) => shardOf(all, i, 7).map((c) => c.id)).flat();
    expect(owned.toSorted()).toEqual(all.map((c) => c.id).toSorted());
  });

  it("rebuilds a refinement step from its stored structure, with the seeds the screen used", () => {
    const cell = all.find((c) => c.refine !== undefined) as (typeof all)[number];
    const step = cell.refine?.(cell.points.slice(0, 5), G2_STRUCTURES)[0];
    expect(step).toBeDefined();
    const byCell = new Map(all.map((c) => [c.id, c]));
    const rebuilt = pointById(byCell, step?.id as string, step?.params["structure"] as string);
    expect([rebuilt.seed, rebuilt.confirmSeed, rebuilt.recheckSeed]).toEqual([
      step?.seed,
      step?.confirmSeed,
      step?.recheckSeed,
    ]);
    expect(rebuilt.params).toEqual(step?.params);
    expect(pointById(byCell, (cell.points[3] as (typeof points)[number]).id, undefined)).toBe(
      cell.points[3],
    );
  });
});
