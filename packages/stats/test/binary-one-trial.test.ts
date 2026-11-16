// REQ-50, REQ-111: the exact type-I study of the binary regression test at one trial per case
// (scripts/study-binary-one-trial.ts) computes what the decision path does. Its rejection table is
// the exact McNemar test's, its dynamic programme equals brute-force enumeration through
// `compareCounts` itself, and its committed results are what the script writes.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createRng } from "../src/index.ts";
import {
  ALPHA,
  bruteForceTypeI,
  exactTypeI,
  noisyCount,
  perturb,
  randomStructure,
  rejectionThresholds,
  type Structure,
} from "../scripts/binary-one-trial.ts";

const thresholds = rejectionThresholds(300);

/** The largest c with P(Binomial(n, 1/2) ≤ c) ≤ 0.05, in exact integer arithmetic. */
function mcnemarThreshold(n: number): number {
  let choose = 1n;
  let cumulative = 0n;
  let last = -1;
  for (let c = 0; c <= n; c++) {
    if (c > 0) choose = (choose * BigInt(n - c + 1)) / BigInt(c);
    cumulative += choose;
    if (20n * cumulative <= 2n ** BigInt(n)) last = c;
    else break;
  }
  return last;
}

describe("binary regression test at one trial per case", () => {
  it("rejects exactly where the exact McNemar test does, for every n up to 300", () => {
    for (let n = 0; n <= 300; n++) expect(thresholds[n], `n=${n}`).toBe(mcnemarThreshold(n));
  });

  it("the dynamic programme equals brute-force enumeration through compareCounts, k ≤ 8", () => {
    const rng = createRng(424242);
    for (const k of [2, 3, 5, 6, 7, 8])
      for (const family of ["top", "floor"] as const) {
        const s = randomStructure(rng, k, family);
        expect(
          Math.abs(exactTypeI(s, thresholds) - bruteForceTypeI(s)),
          `k=${k} ${family}`,
        ).toBeLessThan(1e-15);
      }
    // A structure with rejections well above zero, so the agreement is not 0 = 0.
    const drop: Structure = [
      [0.9, 0.1],
      [0.8, 0.2],
      [0.9, 0.3],
      [0.7, 0.1],
      [0.95, 0.05],
      [0.5, 0.5],
      [0.6, 0.2],
      [0.9, 0.4],
    ];
    const p = bruteForceTypeI(drop);
    expect(p).toBeGreaterThan(0.3);
    expect(Math.abs(exactTypeI(drop, thresholds) - p)).toBeLessThan(1e-15);
    // Enumeration at k = 8 runs 65,536 comparisons per structure.
  }, 120_000);

  it("keeps the level under the sharp null: every case has the same rate in both arms", () => {
    for (const k of [5, 12, 60, 300]) {
      const sharp: Structure = Array.from({ length: k }, (_, i) => [
        0.1 + 0.8 * (i / k),
        0.1 + 0.8 * (i / k),
      ]);
      expect(exactTypeI(sharp, thresholds)).toBeLessThanOrEqual(ALPHA);
    }
  });

  it("draws structures with a true mean difference of 0 and rates in [0, 1]", () => {
    const rng = createRng(7);
    for (const k of [5, 12, 300])
      for (const family of ["top", "floor"] as const)
        for (let i = 0; i < 50; i++) {
          const s = randomStructure(rng, k, family);
          const next = perturb(rng, s, noisyCount(s)) ?? s;
          for (const x of [s, next]) {
            expect(x).toHaveLength(k);
            expect(Math.abs(x.reduce((a, [b, c]) => a + c - b, 0))).toBeLessThan(1e-9);
            expect(x.flat().every((v) => v >= 0 && v <= 1)).toBe(true);
          }
        }
  });

  it("the committed results recompute from their stored worst structures", () => {
    const rows = readFileSync(
      join(import.meta.dirname, "..", "validation", "binary-one-trial.tsv"),
      "utf8",
    )
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => line.split("\t"));
    expect(rows.length).toBeGreaterThan(0);
    for (const [k, family, , , worst, passes, structure] of rows) {
      const s = JSON.parse(structure as string) as Structure;
      expect(s, `${k} ${family}`).toHaveLength(Number(k));
      const p = exactTypeI(s, thresholds);
      expect(p.toPrecision(10)).toBe(worst);
      expect(String(p <= ALPHA)).toBe(passes);
    }
  });
});
