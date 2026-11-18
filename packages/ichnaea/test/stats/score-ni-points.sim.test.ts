// The points of stage 1 of the score non-inferiority study (scripts/stats/score-ni-points.ts) as
// the rule needs them: S-C and S-B with φ_min = 0 are must-fail controls, never selectable; G4 with
// separate shocks and G2 at truth 0 run as reported points only; and the seed rules hold for every
// point. Building every cell takes about 40 seconds, so this runs with the simulation studies.
import { describe, expect, it } from "vitest";

import {
  G2_NI_STRUCTURES,
  G2_ZERO_BASE,
  G2_ZERO_MARGIN,
  MARGINS,
  NI_SHAPES,
  niCells,
  SETTINGS,
} from "../../scripts/stats/score-ni-points.ts";
import { TIE_ORDER } from "../../scripts/stats/collect-score-ni.ts";

const all = niCells();
const points = all.flatMap((c) => c.points);

describe("score non-inferiority stage 1: settings and reported points", () => {
  it("makes S-C and S-B with φ_min = 0 controls, and only S-A and S-B with φ_min > 0 selectable", () => {
    expect(SETTINGS.filter((s) => s.role === "candidate").map((s) => s.name)).toEqual([
      "S-A",
      "S-B phi_min 0.01",
      "S-B phi_min 0.02",
      "S-B phi_min 0.05",
      "S-B phi_min 0.1",
    ]);
    expect(SETTINGS.filter((s) => s.role === "must-fail").map((s) => s.name)).toEqual([
      "S-B phi_min 0",
      "S-C",
    ]);
    expect(TIE_ORDER).not.toContain("S-C");
  });

  it("runs G4 with separate shocks at both truths, reported only", () => {
    const separate = points.filter((p) => p.generator === 4 && p.family.endsWith("-separate"));
    expect(separate.length).toBe(4 * NI_SHAPES.length * MARGINS.length * 2);
    expect(separate.every((p) => p.reported)).toBe(true);
    expect(new Set(separate.map((p) => p.truth))).toEqual(new Set(["margin", "zero"]));
    // Every point that decides is in the domain: shared shocks only, and never at G2 truth 0.
    expect(points.filter((p) => !p.reported).some((p) => p.family.endsWith("-separate"))).toBe(
      false,
    );
  });

  it("runs G2 at truth 0 on the first 100 structures of each cell, with no refinement, reported only", () => {
    const zeroCells = all.filter((c) => c.id.endsWith("/zero") && c.id.startsWith("G2/"));
    expect(zeroCells.length).toBe(5 * NI_SHAPES.length);
    for (const cell of zeroCells) {
      expect(cell.refine).toBeUndefined();
      expect(cell.points.length + (cell.skipped ?? 0)).toBe(G2_NI_STRUCTURES);
      for (const p of cell.points) {
        expect(p).toMatchObject({ truth: "zero", reported: true, margin: G2_ZERO_MARGIN });
        const rows = JSON.parse(p.params["structure"] as string) as number[][];
        const truth =
          rows.reduce((a, r) => a + (r[1] as number) - (r[0] as number), 0) / rows.length;
        expect(Math.abs(truth)).toBeLessThanOrEqual(1e-9);
        expect(p.seed - G2_ZERO_BASE).toBeGreaterThanOrEqual(0);
        expect(p.seed - G2_ZERO_BASE).toBeLessThan(1_000_000);
      }
    }
    // Top and floor at truth 0 draw the mean-0 shapes of the cell at the same margin, s for s.
    const atMargin = all.find((c) => c.id === "G2/top-nu2/k12-r2/m0.100")?.points ?? [];
    const zero = new Map(
      (all.find((c) => c.id === "G2/top-nu2/k12-r2/m0.100/zero")?.points ?? []).map((p) => [
        /\/s(\d+)$/.exec(p.id)?.[1],
        p,
      ]),
    );
    expect(atMargin.length).toBeGreaterThan(0);
    for (const p of atMargin)
      expect(
        JSON.parse(zero.get(/\/s(\d+)$/.exec(p.id)?.[1])?.params["structure"] as string),
      ).toEqual(JSON.parse(p.params["shape"] as string));
  });

  it("keeps every seed by its rule: c below 100,000, and nothing at stage 2's 70,000,000", () => {
    for (const p of points) {
      if (p.generator !== 2) {
        const c = p.seed - 30_000_000 - 100_000 * p.generator;
        expect(c >= 0 && c < 100_000, p.id).toBe(true);
        expect(p.confirmSeed - p.seed).toBe(10_000_000);
      }
      expect(p.confirmSeed).toBeLessThan(70_000_000);
    }
  });
});
