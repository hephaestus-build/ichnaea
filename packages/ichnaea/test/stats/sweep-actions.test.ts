// The confirmation sweep on GitHub Actions: the job plan, the collector's readers and the replica
// comparison with another host's outputs (scripts/README.md).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  embeddedCounts,
  parseSimRow,
  readExactMargin,
  simulationCells,
} from "../scripts/collect-sweep.ts";
import { canonical, compareReplica, compareSkips, skipEntry } from "../scripts/compare-replica.ts";
import {
  exactFiles,
  MARGINS,
  MAX_MATRIX_JOBS,
  marginText,
  parsePhases,
  plan,
  range,
  serverOrder,
  simulationInputs,
  workersOf,
} from "../scripts/sweep-job.ts";

const dir = mkdtempSync(path.join(tmpdir(), "sweep-actions-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the plan", () => {
  it("runs one job per margin of each exact phase, and the simulation sets in shards", () => {
    const p = plan(parsePhases("A,B,C,D,E-large,E-embedded"));
    expect(p.exact.include).toHaveLength(3 * 51);
    expect(p.exact.include[0]).toEqual({ phase: "A", margin: 0, artifact: "sweep-exact-A-0.050" });
    expect(p.exact.include.at(-1)).toEqual({
      phase: "C",
      margin: 50,
      artifact: "sweep-exact-C-0.300",
    });
    expect(p.skips.include.map((j) => j.set)).toEqual([
      ...Array<string>(4).fill("D-A"),
      ...Array<string>(16).fill("D-B"),
      ...Array<string>(4).fill("D-C"),
    ]);
    expect(p.large.include).toHaveLength(32);
    expect(p.embedded.include.map((j) => j.artifact)).toEqual([
      "sweep-sim-E-embedded-00",
      "sweep-sim-E-embedded-01",
    ]);
    expect(workersOf(3)).toEqual([12, 13, 14, 15]);
  });

  it("refuses a phase whose inputs are not selected", () => {
    expect(() => parsePhases("A,B,D")).toThrow(/needs all three/);
    expect(() => parsePhases("E-embedded")).toThrow(/needs B/);
    expect(() => parsePhases("")).toThrow(/at least one/);
    expect(() => parsePhases("F")).toThrow(/unknown phase/);
    expect(parsePhases("E-large,A")).toEqual(["A", "E-large"]);
  });

  it("runs a pre-check of one margin for the exact phases and the large suites only", () => {
    const p = plan(parsePhases("A,B,C,E-large"), [13]);
    expect(p.margins).toBe("13");
    expect(p.exact.include.map((j) => j.artifact)).toEqual([
      "sweep-exact-A-0.115",
      "sweep-exact-B-0.115",
      "sweep-exact-C-0.115",
    ]);
    expect(p.large.include).toHaveLength(32);
    expect(() => plan(parsePhases("A,B,C,D"), [13])).toThrow(/need every margin/);
    expect(() => plan(parsePhases("B,E-embedded"), [13])).toThrow(/need every margin/);
    expect(plan(parsePhases("A")).margins).toBe(range(MARGINS).join(","));
  });

  it("keeps every matrix within GitHub's limit of 256 jobs", () => {
    const p = plan(parsePhases("A,B,C,D,E-large,E-embedded"));
    for (const m of [p.exact, p.skips, p.large, p.embedded])
      expect(m.include.length).toBeLessThanOrEqual(MAX_MATRIX_JOBS);
    expect(() => plan(parsePhases("E-large"), undefined, 300)).toThrow(/at most 256/);
  });

  it("names the margins as the sweep prints them", () => {
    const names = range(MARGINS).map(marginText);
    expect(names[0]).toBe("0.050");
    expect(names[13]).toBe("0.115");
    expect(names[50]).toBe("0.300");
    expect(new Set(names).size).toBe(51);
  });

  it("reads the skip logs in the server's worker order, so each structure keeps its seed", () => {
    expect(serverOrder(range(9))).toEqual([0, 4, 8, 1, 5, 2, 6, 3, 7]);
    expect(simulationInputs("/r", "D-B", [0, 1, 4]).map((f) => path.basename(f))).toEqual([
      "B-0.050.skips.jsonl",
      "B-0.070.skips.jsonl",
      "B-0.055.skips.jsonl",
    ]);
  });
});

const tsvHeader =
  "margin\trank\tcoverage\tevaluated\tskipped\tk\tr\tnoisy\tstable_base\tstable_candidate\tstable_at_three\tnoisy_rates@trials";
const skipLine = (id: string, margin: number, phase: string, base = 0.3): string =>
  JSON.stringify({
    id,
    margin,
    k: 12,
    r: 2,
    cell: "12|2",
    phase,
    seed: 1,
    groups: [{ count: 12, base, candidate: 0.2, baseTrials: 2, candidateTrials: 2 }],
  });

const row = (id: string, margin: string, cell: string, estimate: number, result = "pass") =>
  parseSimRow(
    [id, margin, 20, 2, cell, "screen", estimate.toFixed(6), "0.003", 6000, result, 7].join("\t"),
  );

const rowsOf = (i: number): string[] => [
  `${marginText(i)}\t1\t0.95000\t10\t1\t12\t2\t1\t1\t0.9\t0\t0.1->0.2@2`,
  `${marginText(i)}\tskip\t1\t10\t1\t12\t2\t1`,
];
const skipsOf = (i: number): string[] => [
  skipLine(`h1-${marginText(i)}-1`, Number(marginText(i)), "random"),
];

const write = (name: string, rows: readonly string[]): string => {
  const file = path.join(dir, name);
  writeFileSync(file, rows.map((r) => `${r}\n`).join(""));
  return file;
};

describe("the collector's reading of an exact margin", () => {
  it("takes the per-cell worst and the skip split, and checks the counts", () => {
    const tsv = write("m.tsv", [
      tsvHeader,
      "0.050\t1\t0.94100\t10\t2\t12\t2/3\t1\t1\t0.9\t3\t0.1->0.2@2",
      "0.050\tk12|2/3\t0.94100\t10\t2\t12\t2/3\t1\t1\t0.9\t3\t0.1->0.2@2",
      "0.050\tk11|2\t0.95000\t10\t2\t11\t2\t1\t1\t0.9\t0\t0.1->0.2@2",
      "0.050\tskip\t2\t10\t2\t12\t2/3\t1",
    ]);
    const skips = write("m.skips.jsonl", [
      skipLine("a", 0.05, "grid"),
      skipLine("b", 0.05, "refine"),
    ]);
    const problems: string[] = [];
    const m = readExactMargin(tsv, skips, "0.050", problems);
    expect(problems).toEqual([]);
    expect(m?.evaluated).toBe(10);
    expect(m?.skipSplit).toEqual({ grid: 1, random: 0, refine: 1 });
    expect(m?.worst.map((w) => [w.cell, w.coverage])).toEqual([
      ["11|2", 0.95],
      ["12|2/3", 0.941],
    ]);
  });

  it("reports a row of another margin, a repeated id and a skip count that does not add up", () => {
    const tsv = write("bad.tsv", [tsvHeader, "0.055\tskip\t3\t10\t3\t12\t2\t1"]);
    const skips = write("bad.skips.jsonl", [
      skipLine("a", 0.05, "grid"),
      skipLine("a", 0.05, "grid"),
    ]);
    const problems: string[] = [];
    readExactMargin(tsv, skips, "0.050", problems);
    expect(problems.join("\n")).toMatch(/a row of margin 0.055/);
    expect(problems.join("\n")).toMatch(/id a twice/);
    expect(problems.join("\n")).toMatch(/3 skipped, skip rows sum to 3, the log has 2/);
  });
});

describe("the collector's simulation summary", () => {
  it("gives per cell and margin the worst, the 5th percentile and the median", () => {
    const rows = range(20).map((i) =>
      row(`s${i}`, "0.050", "20|2", 0.95 + i / 1000, i === 0 ? "fail" : "pass"),
    );
    const [c] = simulationCells(rows);
    expect(c).toMatchObject({
      cell: "20|2",
      margin: "0.050",
      structures: 20,
      fails: 1,
      p5: 0.95,
      median: 0.959,
    });
    expect(c?.worst.id).toBe("s0");
  });

  it("counts the embedding by K and source margin, not by a diluted row's margin", () => {
    const counts = embeddedCounts([
      row("m0.050-w01-K20-dilute", "0.030", "20|2:dilute", 0.96),
      row("m0.050-w01-K20-keep-truth", "0.050", "20|2:keep-truth", 0.93, "fail"),
      row("m0.050-w02-K20-keep-truth", "0.050", "20|2:keep-truth", 0.96),
    ]);
    expect(counts).toEqual([
      { K: 20, margin: "0.050", dilute: 1, "keep-truth": 2, "keep-truthFails": 1 },
    ]);
  });
});

describe("the replica comparison", () => {
  it("canonicalizes members in sorted order, at every depth", () => {
    expect(canonical({ b: 1, a: [{ d: 0.1, c: "x" }] })).toBe('{"a":[{"c":"x","d":0.1}],"b":1}');
    expect(canonical(JSON.parse('{"x":1e-16,"y":1.0}'))).toBe('{"x":1e-16,"y":1}');
  });

  it("lists missing, extra, differing and reordered entries", () => {
    const s = [
      skipLine("a", 0.05, "grid"),
      skipLine("b", 0.05, "grid"),
      skipLine("c", 0.05, "grid"),
    ].map(skipEntry);
    expect(compareSkips(s, s)).toEqual({ missing: [], extra: [], differing: [], reordered: [] });
    const a = [skipLine("a", 0.05, "grid", 0.4), skipLine("d", 0.05, "grid")].map(skipEntry);
    expect(compareSkips(s, a)).toMatchObject({
      missing: ["b", "c"],
      extra: ["d"],
      differing: ["a"],
    });
    expect(
      compareSkips(
        s,
        [s[1], s[0], s[2]].filter((e) => e !== undefined),
      ).reordered,
    ).toEqual(["0.050"]);
  });

  // Every margin, on a server with 4 workers: each worker file is the per-margin outputs rebuilt.
  const actions = path.join(dir, "actions");
  const server = path.join(dir, "server");
  mkdirSync(server, { recursive: true });
  for (const i of range(MARGINS)) {
    const f = exactFiles(actions, "B", i);
    mkdirSync(f.dir, { recursive: true });
    writeFileSync(f.tsv, [tsvHeader, ...rowsOf(i)].map((r) => `${r}\n`).join(""));
    writeFileSync(
      f.skips,
      skipsOf(i)
        .map((r) => `${r}\n`)
        .join(""),
    );
  }
  const serverFiles = range(4).map((w) => {
    const ms = range(MARGINS).filter((i) => i % 4 === w);
    const tsv = path.join(server, `sweep-${w}.tsv`);
    const skips = path.join(server, `skips-${w}.jsonl`);
    writeFileSync(tsv, [tsvHeader, ...ms.flatMap(rowsOf)].map((r) => `${r}\n`).join(""));
    writeFileSync(
      skips,
      ms
        .flatMap(skipsOf)
        .map((r) => `${r}\n`)
        .join(""),
    );
    return { tsv, skips };
  });
  const compare = () =>
    compareReplica(
      "B",
      actions,
      serverFiles.map((f) => f.tsv),
      serverFiles.map((f) => f.skips),
      range(MARGINS),
    );

  it("finds the server's worker files identical to the per-margin outputs", () => {
    const r = compare();
    expect(r.problems).toEqual([]);
    expect(r.identical).toBe(true);
    expect(r.rebuilt.filter((x) => x.identical)).toHaveLength(8);
    expect(r.counts.server).toEqual({
      lines: 51,
      split: { random: 51 },
      uniqueIds: 51,
      uniqueStructures: 51,
      tsvSkipRows: 51,
    });
  });

  it("fails on one changed row and on one changed skip entry", () => {
    const f = exactFiles(actions, "B", 7);
    writeFileSync(
      f.tsv,
      [tsvHeader, ...rowsOf(7)]
        .map((r) => `${r}\n`)
        .join("")
        .replace("0.95000", "0.95001"),
    );
    writeFileSync(
      f.skips,
      `${skipLine(`h1-${marginText(7)}-1`, Number(marginText(7)), "random", 0.31)}\n`,
    );
    const r = compare();
    expect(r.identical).toBe(false);
    expect(r.rows.differing).toEqual([
      { margin: "0.085", server: 2, actions: 2, firstDifferent: 0 },
    ]);
    expect(r.skips.differing.first).toEqual(["h1-0.085-1"]);
    expect(r.rebuilt.filter((x) => !x.identical).map((x) => x.file)).toEqual([
      "sweep-3.tsv",
      "skips-3.jsonl",
    ]);
  });
});
