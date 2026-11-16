// The root-finder shares its scan and bisection with the decision `lowerRootAtMost`
// (src/stats/solve.ts). The binary intervals must not move. On the machine that runs the test,
// every bound on the reference inputs (scripts/stats/solver-snapshot.ts) is computed twice: with the
// current solver, and with a verbatim copy of the solver before the change
// (test/stats/support/solve-before-refactor.ts, whose body a sha256 pins to main's solve.ts before the
// change), and every one must agree bit for bit. V8's Math is not bit-identical across platforms, so
// the stored bounds (test/stats/reference-solver-snapshot.json) are compared bit for bit on the runtime
// that wrote them (Node version, platform, CPU architecture), and within 1e-9 on any other.
// The decision must equal "lowerRoot(...) ≤ θ" for every function, monotone or not.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { SnapshotRow } from "../../scripts/stats/solver-snapshot.ts";
import { createRng } from "../../src/stats/index.ts";
import { lowerRoot, lowerRootAtMost } from "../../src/stats/solve.ts";

const pinned = JSON.parse(
  readFileSync(join(import.meta.dirname, "reference-solver-snapshot.json"), "utf8"),
) as { platform: string; arch: string; node: string; rows: SnapshotRow[] };

const differing = (a: readonly SnapshotRow[], b: readonly SnapshotRow[]): number => {
  expect(a.length).toBe(b.length);
  let moved = 0;
  a.forEach((r, i) => {
    const p = b[i] as SnapshotRow;
    expect([r.set, r.index, r.sided]).toEqual([p.set, p.index, p.sided]);
    if (!Object.is(r.lower, p.lower) || !Object.is(r.upper, p.upper)) moved++;
  });
  return moved;
};

describe("the root-finder", () => {
  it("gives every binary bound of the reference inputs bit for bit as the solver before the change", async () => {
    vi.resetModules();
    const now = (await import("../../scripts/stats/solver-snapshot.ts")).snapshotRows();
    vi.resetModules();
    vi.doMock("../../src/stats/solve.ts", () => import("./support/solve-before-refactor.ts"));
    try {
      const solver = (await import("../../src/stats/solve.ts")) as { BEFORE_REFACTOR?: boolean };
      expect(solver.BEFORE_REFACTOR).toBe(true);
      const before = (await import("../../scripts/stats/solver-snapshot.ts")).snapshotRows();
      expect(before.length).toBeGreaterThan(2000);
      expect(differing(now, before)).toBe(0);
    } finally {
      vi.doUnmock("../../src/stats/solve.ts");
      vi.resetModules();
    }
  });

  it("gives the stored bounds bit for bit on the runtime that wrote them, within 1e-9 on another", async () => {
    const now = (await import("../../scripts/stats/solver-snapshot.ts")).snapshotRows();
    const sameRuntime =
      process.version === pinned.node &&
      process.platform === pinned.platform &&
      process.arch === pinned.arch;
    if (sameRuntime) expect(differing(now, pinned.rows)).toBe(0);
    else
      now.forEach((r, i) => {
        const p = pinned.rows[i] as SnapshotRow;
        expect(Math.abs(r.lower - p.lower), `${r.set} ${r.index} ${r.sided}`).toBeLessThanOrEqual(
          1e-9,
        );
        expect(Math.abs(r.upper - p.upper), `${r.set} ${r.index} ${r.sided}`).toBeLessThanOrEqual(
          1e-9,
        );
      });
  });

  it("compares with a copy whose body is main's solve.ts before the change", () => {
    const copy = readFileSync(
      join(import.meta.dirname, "support", "solve-before-refactor.ts"),
      "utf8",
    );
    // The copy's own lines end at the marker and its blank line; the body follows verbatim.
    const marker = "export const BEFORE_REFACTOR = true;\n\n";
    expect(copy.includes(marker)).toBe(true);
    const body = copy.slice(copy.indexOf(marker) + marker.length);
    expect(createHash("sha256").update(body).digest("hex")).toBe(
      "eab2dfe380880b6705e2e958112d594240917069baba223a1d1ded33d0a39a0b",
    );
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
