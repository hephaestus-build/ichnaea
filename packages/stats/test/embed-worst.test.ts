// Embedding the worst structures of an exact sweep in larger suites (scripts/embed-worst.ts).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  embed,
  marginsOf,
  padTrials,
  perCellRows,
  RebuildError,
  rebuild,
  structureOf,
  worstRows,
  countByKAndMargin,
} from "../scripts/embed-worst.ts";
import { coverageRun, readStructures, seedOf } from "../scripts/simulate-structures.ts";
import { groupsOf, type Structure } from "../scripts/study-heterogeneous.ts";
import { exactGroupCoverage, type Group, truthOfGroups } from "./support/exact.ts";
import { estimate } from "./support/simulate.ts";

const dir = mkdtempSync(path.join(tmpdir(), "embed-worst-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const HEADER =
  "margin\trank\tcoverage\tevaluated\tskipped\tk\tr\tnoisy\tstable_base\tstable_candidate\tstable_at_three\tnoisy_rates@trials\tone_trial";

/** A per-cell row as the sweep prints it (its `describe`), with the one_trial column. */
function rowText(s: Structure, margin: number, coverage: number): string {
  const groups = groupsOf(s, margin, Number.POSITIVE_INFINITY) as Group[];
  const noisy = groups
    .slice(0, s.noisy.length + 1)
    .map(
      (g) =>
        `${g.base.toFixed(4)}->${g.candidate.toFixed(4)}@${g.baseTrials}${g.candidateTrials === g.baseTrials ? "" : `/${g.candidateTrials}`}`,
    )
    .join(",");
  const o = s.oneTrial;
  return [
    margin.toFixed(3),
    `k${s.k}|${s.r}${o ? "+1t" : ""}`,
    coverage.toFixed(5),
    1000,
    10,
    s.k,
    s.r,
    s.noisy.length + 1,
    s.stableBase,
    Math.min(1, Math.max(0, s.stableBase - s.drop)).toFixed(4),
    s.r === "2/3" ? s.stableAtThree : 0,
    noisy,
    o ? `c${o.candidate}b${o.base}${o.lastNoisy ? `n${o.lastNoisy}` : ""}` : "-",
  ].join("\t");
}

const tsv = (...rows: string[]): string => `${[HEADER, ...rows].join("\n")}\n`;

const margin = 0.05 + 2 * 0.005;
/** Cheap to enumerate: 11 cases, 2 trials, two stable candidate cells with one trial. */
const SMALL: Structure = {
  k: 11,
  r: 2,
  stableAtThree: 0,
  stableBase: 1,
  drop: 0.08314159,
  noisy: [],
  noisyTrials: [2],
  lastBase: 0.61234567,
  oneTrial: { candidate: 2, base: 0 },
};
/** Mixed counts, two noisy cases, and a one-trial base cell on the last noisy case. */
const MIXED: Structure = {
  k: 12,
  r: "2/3",
  stableAtThree: 4,
  stableBase: 0.99,
  drop: 0.1213,
  noisy: [[0.3141, 0.5926]],
  noisyTrials: [3, 2],
  lastBase: 0.7072,
  oneTrial: { candidate: 0, base: 1, lastNoisy: "base" },
};

const smallCoverage = exactGroupCoverage(
  groupsOf(SMALL, margin, Number.POSITIVE_INFINITY) as Group[],
);
const rowOf = (text: string) => {
  const { rows, oneTrial } = perCellRows("sweep-0.tsv", tsv(text));
  return { row: rows[0] as (typeof rows)[number], oneTrial };
};

/** A per-cell row with only the fields that order the worst. */
const orderRow = (m: string, k: number, c: number) => ({
  file: "f",
  line: k,
  margin: m,
  rank: `k${k}|2`,
  coverage: c,
  fields: [m, `k${k}|2`, String(c), "", "", String(k)],
});

describe("rebuilding a sweep row", () => {
  it("rebuilds a structure whose exact coverage matches its TSV row", () => {
    const { row, oneTrial } = rowOf(rowText(SMALL, margin, smallCoverage));
    const b = rebuild(row, margin, oneTrial);
    expect(Math.abs(b.coverage - smallCoverage)).toBeLessThan(5e-5);
    expect(truthOfGroups(b.groups)).toBeCloseTo(-margin, 12);
    // The TSV prints rates to 4 decimals, so the last noisy case was solved again.
    expect(b.resolved).toBe(true);
    expect(b.s).toEqual({
      ...SMALL,
      drop: 1 - Number((1 - SMALL.drop).toFixed(4)),
      lastBase: 0.6123,
    });
    // Rates that print exactly need no new solution.
    const exact = { ...SMALL, drop: 0.0831, lastBase: 0.6123 };
    const again = rowOf(
      rowText(
        exact,
        margin,
        exactGroupCoverage(groupsOf(exact, margin, Number.POSITIVE_INFINITY) as Group[]),
      ),
    );
    expect(rebuild(again.row, margin, again.oneTrial).resolved).toBe(false);
  });

  it("reads mixed counts, two noisy cases and a one-trial cell on the last noisy case", () => {
    const { row, oneTrial } = rowOf(rowText(MIXED, 0.1, 0.95));
    const s = structureOf(row, 0.1, oneTrial);
    expect(s).toMatchObject({
      k: 12,
      r: "2/3",
      stableAtThree: 4,
      stableBase: 0.99,
      noisy: [[0.3141, 0.5926]],
      noisyTrials: [3, 2],
      lastBase: 0.7072,
      oneTrial: { candidate: 0, base: 1, lastNoisy: "base" },
    });
    const groups = groupsOf(s, 0.1, Number.POSITIVE_INFINITY) as Group[];
    expect(truthOfGroups(groups)).toBeCloseTo(-0.1, 12);
    expect(groups[1]).toMatchObject({ baseTrials: 1, candidateTrials: 2 });
  });

  it("stops on a coverage that differs from the TSV's, and on a row it cannot read", () => {
    const off = rowOf(rowText(SMALL, margin, smallCoverage + 1e-4));
    expect(() => rebuild(off.row, margin, off.oneTrial)).toThrow(RebuildError);
    const bad = rowOf(rowText(SMALL, margin, smallCoverage).replace("@2", "@4"));
    expect(() => rebuild(bad.row, margin, bad.oneTrial)).toThrow(/noisy rates unreadable/);
  });

  it("takes the sweep's margins from its arguments and only the per-cell rows", () => {
    const marginOf = marginsOf([
      "0.05",
      "0.30",
      "0.005",
      "0",
      "4",
      "11,12",
      "--seed-base",
      "1000000",
      "--one-trial",
      "--out",
      "x.tsv",
    ]);
    expect(marginOf("0.065")).toBe(0.05 + 3 * 0.005);
    expect(() => marginOf("0.0651")).toThrow(RebuildError);
    const text = rowText(SMALL, margin, smallCoverage);
    const { rows } = perCellRows(
      "s.tsv",
      tsv(text.replace("\tk11|2+1t\t", "\t1\t"), text, "0.060\tskip\t3\t1000\t10\t11\t2\t1"),
    );
    expect(rows.map((r) => r.rank)).toEqual(["k11|2+1t"]);
  });

  it("takes the worst of each margin, by coverage, then k, with margins ascending", () => {
    const rows = [
      orderRow("0.100", 12, 0.95),
      orderRow("0.050", 13, 0.95),
      orderRow("0.050", 12, 0.95),
      orderRow("0.050", 14, 0.948),
      orderRow("0.300", 17, 0.949),
      orderRow("0.050", 10, 0.9),
    ];
    expect(worstRows(rows, 2).map((r) => [r.margin, r.fields[5]])).toEqual([
      ["0.050", "14"],
      ["0.050", "12"],
      ["0.100", "12"],
      ["0.300", "17"],
    ]);
  });
});

describe("embedding in K cases", () => {
  const b = (() => {
    const { row, oneTrial } = rowOf(rowText(SMALL, margin, smallCoverage));
    return rebuild(row, margin, oneTrial);
  })();

  it("dilutes the truth to -margin·k/K with padding that passes every trial", () => {
    for (const K of [20, 30, 60]) {
      const e = embed(b, K, "dilute");
      if (!e.ok) throw new Error(e.reason);
      expect(e.truth).toBeCloseTo((-margin * 11) / K, 12);
      expect(e.groups.slice(0, -1)).toEqual(b.groups);
      expect(e.groups.at(-1)).toEqual({
        count: K - 11,
        base: 1,
        candidate: 1,
        baseTrials: 2,
        candidateTrials: 2,
      });
    }
    expect(padTrials(3)).toBe(3);
    expect(padTrials("2/3")).toBe(2);
  });

  it("keeps the truth at -margin, or reports that it cannot", () => {
    for (const K of [20, 30, 60]) {
      const e = embed(b, K, "keep-truth");
      if (!e.ok) throw new Error(e.reason);
      expect(Math.abs(truthOfGroups(e.groups) + margin)).toBeLessThan(1e-12);
      expect(e.groups.reduce((a, g) => a + g.count, 0)).toBe(K);
      expect(e.groups.at(-1)).toMatchObject({ count: K - 11, base: 1, candidate: 1 });
      // The last noisy case keeps its rate; the stable cases carry the padding's share.
      expect(e.groups[0]?.candidate).toBeCloseTo(b.groups[0]?.candidate ?? -1, 12);
    }
    const steep: Structure = {
      k: 11,
      r: 2,
      stableAtThree: 0,
      stableBase: 1,
      drop: 0.3,
      noisy: [],
      noisyTrials: [2],
      lastBase: 0.9,
    };
    const groups = groupsOf(steep, 0.3, Number.POSITIVE_INFINITY) as Group[];
    const big = { s: steep, margin: 0.3, groups, coverage: 0, resolved: false };
    expect(embed(big, 20, "keep-truth").ok).toBe(true);
    expect(embed(big, 60, "keep-truth")).toEqual({
      ok: false,
      reason: expect.stringMatching(/stable candidate rate -0\.77\d+ is below 0/),
    });
  });

  it("counts the structures that cannot keep their truth per size and margin", () => {
    expect(
      countByKAndMargin([
        { K: 60, margin: 0.3 },
        { K: 60, margin: 0.3 },
        { K: 30, margin: 0.3 },
        { K: 60, margin: 0.05 },
      ]),
    ).toEqual({ "K60|0.300": 2, "K30|0.300": 1, "K60|0.050": 1 });
  });

  it("round-trips into the runner", () => {
    const lines = [20, 60].flatMap((K) =>
      (["dilute", "keep-truth"] as const).map((mode) => {
        const e = embed(b, K, mode);
        if (!e.ok) throw new Error(e.reason);
        return JSON.stringify({
          id: `w01-K${K}-${mode}`,
          margin: -e.truth,
          k: K,
          r: 2,
          cell: `${K}|2+1t:${mode}`,
          mode,
          K,
          truth: e.truth,
          sourceMargin: margin,
          groups: e.groups,
        });
      }),
    );
    const file = path.join(dir, "embedded.jsonl");
    writeFileSync(file, `${lines.join("\n")}\n`);
    const read = readStructures([file]);
    expect(read.map((x) => [x.s.id, x.s.k])).toEqual([
      ["w01-K20-dilute", 20],
      ["w01-K20-keep-truth", 20],
      ["w01-K60-dilute", 60],
      ["w01-K60-keep-truth", 60],
    ]);
    for (const { index, s } of read)
      expect(estimate(coverageRun(s.groups), seedOf(21_000_000, index), 200)).toBeGreaterThan(0.8);
  });
});
