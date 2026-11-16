// The score non-inferiority bounds S-A, S-B and S-C (src/stats/score-interval.ts) match independent
// implementations on every reference table (test/stats/reference-score-permutation-tables.json): an R
// implementation and a Python implementation of S-B, both written from a formula-only
// specification without the TypeScript (scripts/stats/reference-score-intervals.R,
// scripts/stats/score_intervals_oracle.py), and ratesci's stratified score interval for S-A.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  boundSA,
  boundSB,
  boundSC,
  pooledDispersion,
  scoreBound,
} from "../../src/stats/score-interval.ts";
import type { CaseScores } from "../../src/stats/score-permutation-core.ts";

interface Table {
  id: string;
  denominator: number;
  cases: { candidate: number[]; base: number[] }[];
}
const read = <T>(name: string): T =>
  JSON.parse(readFileSync(join(import.meta.dirname, name), "utf8")) as T;
const { tables } = read<{ tables: Table[] }>("reference-score-permutation-tables.json");
const fromR = read<{
  results: {
    id: string;
    estimate: number;
    phiHat: number;
    sa: number;
    saRatesci: number;
    sb: Record<string, number>;
    sc: number | null;
  }[];
}>("reference-r-score-intervals.json").results;
const fromPython = read<{ results: { id: string; sb: Record<string, number> }[] }>(
  "reference-python-score-intervals.json",
).results;

/** The oracles solve to about 1e-15 and print 15 digits; the largest difference measured is 2.1e-13. */
const TOLERANCE = 1e-10;
/** ratesci rounds its output to 12 decimals and stops its search early (about 1e-11 measured). */
const RATESCI_TOLERANCE = 1e-9;
const FLOORS = ["0", "0.01", "0.02", "0.05", "0.1"] as const;

const scores = (t: Table): CaseScores[] =>
  t.cases.map((c, i) => ({
    id: `c${i}`,
    candidate: c.candidate.map((u) => u / t.denominator),
    base: c.base.map((u) => u / t.denominator),
  }));

describe("score bounds: reference values", () => {
  it("has a result from each oracle for every table", () => {
    expect(fromR.map((r) => r.id)).toEqual(tables.map((t) => t.id));
    expect(fromPython.map((r) => r.id)).toEqual(tables.map((t) => t.id));
  });

  it.each(tables.map((t, i) => [t.id, i] as const))("%s matches R, Python and ratesci", (_, i) => {
    const cases = scores(tables[i] as Table);
    const r = fromR[i] as (typeof fromR)[number];
    const p = fromPython[i] as (typeof fromPython)[number];
    expect(Math.abs(pooledDispersion(cases) - r.phiHat)).toBeLessThanOrEqual(TOLERANCE);
    const sa = boundSA(cases, 0.95);
    expect(Math.abs(sa - r.sa)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(sa - r.saRatesci)).toBeLessThanOrEqual(RATESCI_TOLERANCE);
    for (const f of FLOORS) {
      const sb = boundSB(cases, 0.95, Number(f));
      expect(Math.abs(sb - (r.sb[f] as number)), `φ_min ${f}`).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(sb - (p.sb[f] as number)), `φ_min ${f}`).toBeLessThanOrEqual(TOLERANCE);
    }
    const sc = boundSC(cases, 0.95);
    if (r.sc === null) expect(sc).toBeNull();
    else expect(Math.abs((sc as number) - r.sc)).toBeLessThanOrEqual(TOLERANCE);
  });
});

describe("score bounds: definition", () => {
  const binary: CaseScores[] = [
    { id: "a", candidate: [1, 0], base: [1, 1] },
    { id: "b", candidate: [1, 1], base: [0, 1] },
    { id: "c", candidate: [0, 0, 1], base: [1, 0, 1] },
  ];

  it("has φ̂ = 1 for 0/1 values, so S-B is S-A on binary data at every floor", () => {
    expect(pooledDispersion(binary)).toBe(1);
    for (const f of FLOORS) expect(boundSB(binary, 0.95, Number(f))).toBe(boundSA(binary, 0.95));
  });

  it("keeps φ̂ at most 1 for any values in [0, 1]", () => {
    for (const t of tables) expect(pooledDispersion(scores(t))).toBeLessThanOrEqual(1 + 1e-15);
  });

  it("puts the bound at the estimate when φ = 0", () => {
    const t = scores(tables.find((x) => x.id === "decimal3-k8-r3-shift-50") as Table);
    const estimate =
      t.reduce(
        (a, c) =>
          a +
          c.candidate.reduce((x, y) => x + y, 0) / c.candidate.length -
          c.base.reduce((x, y) => x + y, 0) / c.base.length,
        0,
      ) / t.length;
    expect(Math.abs(scoreBound(t, 0.95, 0) - estimate)).toBeLessThan(1e-12);
  });

  it("has no S-C bound without residual degrees of freedom", () => {
    expect(boundSC([{ id: "a", candidate: [0.5], base: [0.25] }], 0.95)).toBeNull();
  });
});
