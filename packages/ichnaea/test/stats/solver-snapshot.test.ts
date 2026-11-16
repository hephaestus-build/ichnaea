// The root-finder shares its scan and bisection with the decision `lowerRootAtMost` (src/stats/solve.ts).
// The binary intervals must not move: every bound on the reference inputs equals, bit for bit, the
// one the root-finder gave before the change (test/stats/reference-solver-snapshot.json, written by
// scripts/stats/solver-snapshot.ts). The decision must equal "lowerRoot(...) ≤ θ" for every function,
// monotone or not.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { snapshotRows, type SnapshotRow } from "../../scripts/stats/solver-snapshot.ts";
import { createRng } from "../../src/stats/index.ts";
import { lowerRoot, lowerRootAtMost } from "../../src/stats/solve.ts";

const { rows: pinned } = JSON.parse(
  readFileSync(join(import.meta.dirname, "reference-solver-snapshot.json"), "utf8"),
) as { rows: SnapshotRow[] };

describe("the root-finder", () => {
  it("gives every binary bound of the reference inputs bit for bit as before", () => {
    const now = snapshotRows();
    expect(now.length).toBe(pinned.length);
    expect(pinned.length).toBeGreaterThan(2000);
    let moved = 0;
    now.forEach((r, i) => {
      const p = pinned[i] as SnapshotRow;
      expect([r.set, r.index, r.sided]).toEqual([p.set, p.index, p.sided]);
      if (!Object.is(r.lower, p.lower) || !Object.is(r.upper, p.upper)) moved++;
    });
    expect(moved).toBe(0);
  });
});

/** A step up or down of about one unit in the last place, and never zero. */
const nextUp = (x: number): number => x + Math.abs(x) * Number.EPSILON + Number.MIN_VALUE;
const nextDown = (x: number): number => x - Math.abs(x) * Number.EPSILON - Number.MIN_VALUE;

describe("lowerRootAtMost", () => {
  it("equals lowerRoot(...) ≤ θ on non-monotone functions, at every θ tried", () => {
    const rng = createRng(17);
    let checked = 0;
    for (let t = 0; t < 2000; t++) {
      const kind = t % 4;
      const a = rng.uniform() * 2 - 1;
      const w = 5 + rng.uniform() * 60;
      const dip = rng.uniform() * 2 - 1;
      // Decreasing with an oscillation; a narrow dip that a grid step can miss; a step; a root
      // exactly on a grid point of the scan.
      const f = (x: number): number => {
        if (kind === 0) return -x + a + 0.3 * Math.sin(w * x);
        if (kind === 1) return -x + a + (Math.abs(x - dip) < 0.004 ? -2 : 0);
        if (kind === 2) return x < a ? 1 : x < dip ? 0.5 : -1;
        return -0.04 * Math.round((x + 1) / 0.04) + 1 + a;
      };
      const target = rng.uniform() * 0.6 - 0.3;
      const root = lowerRoot(f, target, -1, 1);
      const thetas = [root, nextUp(root), nextDown(root), -1, 1, rng.uniform() * 2 - 1, dip, a];
      for (const theta of thetas) {
        expect(lowerRootAtMost(f, target, -1, 1, theta), `${kind} θ=${theta} root=${root}`).toBe(
          root <= theta,
        );
        checked++;
      }
    }
    expect(checked).toBe(16_000);
  });
});
