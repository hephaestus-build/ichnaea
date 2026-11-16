// The tooling of the margin-floor confirmation: the structure generator, the simulation runner,
// the skip log of the sweep and the provenance check (VALIDATION.md, "The bar").
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { createRng } from "../../src/stats/index.ts";
import { checkProvenance } from "../../scripts/stats/check-sweep-provenance.ts";
import { cells, cellStructures, generate } from "../../scripts/stats/generate-structures.ts";
import {
  git,
  localImportClosure,
  metaPath,
  PROVENANCE_SCHEMA,
  repoRoot,
  sha256,
} from "../../scripts/stats/provenance.ts";
import {
  coverageRun,
  doneIds,
  HEADER,
  parseStructure,
  readStructures,
  runShard,
  seedOf,
} from "../../scripts/stats/simulate-structures.ts";
import {
  cost,
  groupsOf,
  maxOneTrial,
  oneTrialOf,
  skipRecord,
  type Structure,
} from "../../scripts/stats/study-heterogeneous.ts";
import { exactGroupCoverage, type Group, truthOfGroups } from "./support/exact.ts";
import { CONFIRM_SEED_OFFSET, estimate } from "./support/simulate.ts";

const dir = mkdtempSync(path.join(tmpdir(), "floor-confirmation-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const structure = (s: Structure, margin: number): Group[] => {
  const groups = groupsOf(s, margin, Number.POSITIVE_INFINITY);
  if (!groups) throw new Error("no structure");
  return groups;
};

const line = (id: string, margin: number, s: Structure): string =>
  JSON.stringify({
    id,
    margin,
    k: s.k,
    r: s.r,
    cell: `${s.k}|${s.r}`,
    groups: structure(s, margin),
  });

const base = { stableAtThree: 0, stableBase: 1, noisy: [] } as const;
/** Small structures, cheap to enumerate, with exact coverages from 0.94 to 0.995. */
const SMALL: ReadonlyArray<readonly [Structure, number]> = [
  [{ ...base, k: 5, r: 3, drop: 0.15, noisyTrials: [3], lastBase: 0.4 }, 0.05],
  [{ ...base, k: 5, r: 2, stableBase: 0.7, drop: 0.1, noisyTrials: [2], lastBase: 0.5 }, 0.1],
  [
    {
      ...base,
      k: 6,
      r: "2/3",
      stableAtThree: 2,
      drop: 0.1,
      noisy: [[0.4, 0.6]],
      noisyTrials: [2, 3],
      lastBase: 0.7,
    },
    0.1,
  ],
  [
    {
      ...base,
      k: 5,
      r: 2,
      drop: 0.2,
      noisyTrials: [2],
      lastBase: 0.6,
      oneTrial: { candidate: 1, base: 0 },
    },
    0.2,
  ],
];
/** Structures that clear screening by far, so the runner never confirms them in the unit suite. */
const CLEAR: ReadonlyArray<readonly [Structure, number]> = [
  [{ ...base, k: 5, r: 3, drop: 0, noisyTrials: [3], lastBase: 0.3 }, 0.05],
  SMALL[2] as readonly [Structure, number],
  SMALL[3] as readonly [Structure, number],
];

const oneTrialCells = (groups: readonly Group[]): number =>
  groups.reduce(
    (a, g) => a + g.count * (Number(g.baseTrials === 1) + Number(g.candidateTrials === 1)),
    0,
  );

// The runner tests screen at 6,000 repetitions; a loaded machine needs more than the default 5 s.
describe("the simulation runner", { timeout: 60_000 }, () => {
  it("estimates the coverage that exact enumeration gives", () => {
    for (const [i, [s, margin]] of SMALL.entries()) {
      const groups = structure(s, margin);
      const exact = exactGroupCoverage(groups);
      const reps = 4000;
      const simulated = estimate(coverageRun(groups), 4242 + i, reps);
      expect(Math.abs(simulated - exact)).toBeLessThan(3 * Math.sqrt((exact * (1 - exact)) / reps));
    }
  });

  it("gives a structure the seed of its index, and confirmations seeds no screen uses", () => {
    expect([0, 1, 99_999, 100_000, 250_000].map((i) => seedOf(20_000_000, i))).toEqual([
      20_000_000, 20_000_001, 20_099_999, 20_200_000, 20_450_000,
    ]);
    const screens = new Set(Array.from({ length: 300_000 }, (_, i) => seedOf(1, i)));
    expect(screens.size).toBe(300_000);
    expect([...screens].filter((s) => screens.has(s + CONFIRM_SEED_OFFSET))).toEqual([]);
    expect(() => seedOf(2 ** 32 - 50_000, 0)).toThrow(RangeError);
  });

  it("refuses a structure whose truth is not -margin", () => {
    const groups = structure(SMALL[0]?.[0] as Structure, 0.05);
    const json = (margin: number): string =>
      JSON.stringify({ id: "x", margin, k: 5, r: 3, cell: "5|3", groups });
    expect(parseStructure(json(0.05)).groups).toEqual(groups);
    expect(() => parseStructure(json(0.06))).toThrow(/-margin/);
    expect(() => parseStructure('{"id":"a\\tb"}')).toThrow(TypeError);
  });

  it("resumes: skips finished ids, reruns a cut-off row, and keeps every seed", () => {
    const input = path.join(dir, "clear.jsonl");
    writeFileSync(input, CLEAR.map(([s, m], i) => line(`s${i}`, m, s)).join("\n"));
    const all = readStructures([input]);
    const shard = { seedBase: 30_000_000, worker: 0, workers: 1, minK: 1 };
    const full = path.join(dir, "full.tsv");
    expect(runShard(all, shard, full)).toBe(3);
    const rows = readFileSync(full, "utf8").split("\n");
    expect(rows[0]).toBe(HEADER);
    expect(rows.slice(1, 4).map((r) => r.split("\t").at(-2))).toEqual(["pass", "pass", "pass"]);
    expect(rows.slice(1, 4).map((r) => Number(r.split("\t").at(-1)))).toEqual([
      30_000_000, 30_000_001, 30_000_002,
    ]);
    // A run stopped after the first row and in the middle of the second.
    const partial = path.join(dir, "partial.tsv");
    writeFileSync(partial, `${rows.slice(0, 2).join("\n")}\n${rows[2]?.slice(0, 7)}`);
    expect([...doneIds(partial)]).toEqual(["s0"]);
    expect(runShard(all, shard, partial)).toBe(2);
    expect(readFileSync(partial, "utf8")).toBe(readFileSync(full, "utf8"));
    expect(runShard(all, shard, partial)).toBe(0);
  });

  it("shards by index and leaves structures below --min-k out", () => {
    const input = path.join(dir, "shard.jsonl");
    writeFileSync(input, CLEAR.map(([s, m], i) => line(`t${i}`, m, s)).join("\n"));
    const all = readStructures([input]);
    const out = path.join(dir, "shard.tsv");
    expect(runShard(all, { seedBase: 40_000_000, worker: 1, workers: 2, minK: 6 }, out)).toBe(1);
    expect(readFileSync(out, "utf8").split("\n")[1]?.split("\t")[0]).toBe("t1");
  });
});

describe("the skip log of the sweep", () => {
  it("round-trips a skipped structure into the runner", () => {
    const s: Structure = {
      k: 17,
      r: "2/3",
      stableAtThree: 6,
      stableBase: 1,
      drop: 0.12,
      noisy: [[0.3, 0.8]],
      noisyTrials: [3, 2],
      lastBase: 0.6,
      oneTrial: { candidate: 2, base: 1 },
    };
    const groups = structure(s, 0.1);
    expect(cost(groups)).toBeGreaterThan(20_000);
    expect(groupsOf(s, 0.1)).toBeUndefined();
    const file = path.join(dir, "skips.jsonl");
    writeFileSync(file, `${skipRecord("h1000000-0.100-1", 0.1, s, "random", 1_001_000, groups)}\n`);
    const [read] = readStructures([file]);
    expect(read?.s).toEqual({
      id: "h1000000-0.100-1",
      margin: 0.1,
      k: 17,
      r: "2/3",
      cell: "17|2/3+1t",
      groups,
    });
    expect(truthOfGroups(read?.s.groups ?? [])).toBeCloseTo(-0.1, 12);
    const covered = estimate(coverageRun(read?.s.groups ?? []), seedOf(1, read?.index ?? 0), 200);
    expect(covered).toBeGreaterThan(0.5);
  });

  it("places at most 10% one-trial cells, and at least one", () => {
    const rng = createRng(77);
    const u = (): number => rng.uniform();
    let checked = 0;
    for (let i = 0; i < 2000; i++) {
      const k = 5 + Math.floor(u() * 13);
      const noisy = 1 + Math.floor(u() * 3);
      const o = oneTrialOf(k, u);
      const total = o.candidate + o.base + (o.lastNoisy ? 1 : 0);
      expect(total).toBeGreaterThanOrEqual(1);
      expect(total).toBeLessThanOrEqual(maxOneTrial(k));
      const groups = groupsOf(
        {
          k,
          r: 2,
          stableAtThree: 0,
          stableBase: 1,
          drop: 0,
          noisy: Array.from({ length: noisy - 1 }, () => [0.5, 0.5] as const),
          noisyTrials: Array.from({ length: noisy }, () => 2),
          lastBase: 0.5 + 0.5 * k * 0.01,
          oneTrial: o,
        },
        0.01,
        Number.POSITIVE_INFINITY,
      );
      if (!groups) continue;
      checked++;
      expect(oneTrialCells(groups)).toBe(total);
      expect(oneTrialCells(groups)).toBeLessThanOrEqual(0.1 * 2 * k);
    }
    expect(checked).toBe(2000);
  });
});

describe("the structure generator", () => {
  const margins = [0.05, 0.155, 0.3];
  const suites = margins.map((m, i) =>
    cells(true).flatMap((cell, j) => {
      const rng = createRng(7_000_000 + 1000 * i + j);
      return cellStructures(cell, m, 300, () => rng.uniform(), `g-${m}-${cell.name}`);
    }),
  );

  it("gives 300 structures per margin and cell, 121 of them the grid, each mean exactly -margin", () => {
    for (const [i, suite] of suites.entries()) {
      for (const cell of cells(true)) {
        const own = suite.filter((l) => l.cell === cell.name);
        expect(own).toHaveLength(300);
        expect(own.filter((l) => l.family === "grid")).toHaveLength(121);
      }
      for (const l of suite) {
        expect(l.margin).toBe(margins[i]);
        expect(Math.abs(truthOfGroups(l.groups) + l.margin)).toBeLessThan(1e-12);
        expect(l.groups.reduce((a, g) => a + g.count, 0)).toBe(l.k);
        for (const g of l.groups) {
          expect(g.base).toBeGreaterThanOrEqual(0);
          expect(g.candidate).toBeGreaterThanOrEqual(0);
          expect(g.candidate).toBeLessThanOrEqual(1);
        }
        // Stable cases pass every base trial; noisy cases are one to three.
        expect(l.groups.filter((g) => g.count === 1 && g.base < 1).length).toBeLessThanOrEqual(3);
      }
    }
  });

  it("keeps each cell's trial layout", () => {
    for (const l of suites.flat()) {
      const cell = cells(true).find((c) => c.name === l.cell);
      if (!cell) throw new Error(l.cell);
      const planned = l.groups.flatMap((g) =>
        Array.from({ length: g.count }, () => Math.max(g.baseTrials, g.candidateTrials)),
      );
      if (cell.atThree !== undefined) {
        expect(planned.filter((t) => t === 3)).toHaveLength(cell.atThree);
        expect(planned.filter((t) => t === 2)).toHaveLength(l.k - cell.atThree);
      } else if (cell.r === "2/3") {
        expect(planned.every((t) => t === 2 || t === 3)).toBe(true);
        expect(planned.filter((t) => t === 3).length).toBeGreaterThanOrEqual(1);
      } else expect(planned.every((t) => t === cell.r)).toBe(true);
      if (!cell.oneTrial) expect(oneTrialCells(l.groups)).toBe(0);
    }
  });

  it("never gives the one-trial family more than 10% one-trial cells", () => {
    for (const l of suites.flat().filter((x) => x.cell.endsWith("+1t"))) {
      const n = oneTrialCells(l.groups);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(0.1 * 2 * l.k);
    }
  });

  it("is deterministic from its seed base", () => {
    const a = generate(0.05, 0.06, 0.005, 121, 7_000_000, true);
    expect(generate(0.05, 0.06, 0.005, 121, 7_000_000, true)).toEqual(a);
    expect(a).toHaveLength(3 * 22 * 121);
    expect(new Set(a.map((l) => l.id)).size).toBe(a.length);
  });
});

const scripts = path.join(import.meta.dirname, "../../scripts/stats");
/** Paths relative to the package. */
const relative = (files: readonly string[]): string[] =>
  files.map((f) => path.relative(path.join(import.meta.dirname, "../.."), f));

describe("the provenance of a study", () => {
  it("records every local module a script imports, through the statistics it calls", () => {
    const files = relative(localImportClosure([path.join(scripts, "simulate-structures.ts")]));
    expect(files).toEqual(
      expect.arrayContaining([
        "scripts/stats/simulate-structures.ts",
        "scripts/stats/provenance.ts",
        "test/stats/support/simulate.ts",
        "src/stats/index.ts",
        "src/stats/compare.ts",
        "test/stats/support/exact.ts",
      ]),
    );
    expect(files.every((f) => !f.includes("node_modules"))).toBe(true);
    expect(files).toEqual(files.toSorted());
  });

  it("refuses one file for both the TSV and the skip log", () => {
    const same = path.join(dir, "same.out");
    const run = (): string =>
      execFileSync(
        process.execPath,
        [
          path.join(scripts, "study-heterogeneous.ts"),
          "0.05",
          "0.05",
          "0.005",
          "--out",
          same,
          "--skip-log",
          path.relative(process.cwd(), same),
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    expect(run).toThrow(/name the same file/);
  });
});

describe("the provenance check", () => {
  const root = repoRoot(import.meta.filename);
  const head = git(["rev-parse", "HEAD"], root);
  const file = "packages/ichnaea/test/stats/support/exact.ts";
  // This change leaves the file as it is at HEAD.
  const atHead = sha256(readFileSync(path.join(root, file)));

  const output = (name: string, meta: Record<string, unknown>): string => {
    const out = path.join(dir, name);
    writeFileSync(out, "margin\n0.050\n");
    const body = {
      schema: PROVENANCE_SCHEMA,
      commit: head,
      files: { [file]: atHead },
      complete: true,
      outputSha256: sha256(readFileSync(out)),
      ...meta,
    };
    writeFileSync(metaPath(out), JSON.stringify(body));
    return out;
  };

  it("accepts an output whose commit and sha256 match the scripts at HEAD", () => {
    expect(checkProvenance([output("good.tsv", {})], root)).toEqual([]);
  });

  it("fails an output whose recorded sha256 does not match", () => {
    const out = output("sha.tsv", { files: { [file]: "0".repeat(64) } });
    expect(checkProvenance([out], root)).toEqual([
      expect.stringMatching(/has sha256 .* records 0{64}/),
    ]);
  });

  it("fails an output whose commit is unknown", () => {
    const out = output("commit.tsv", { commit: "0123456789abcdef0123456789abcdef01234567" });
    expect(checkProvenance([out], root)).toEqual([
      expect.stringMatching(/commit 0123456789.* is unknown/),
    ]);
  });

  it("fails an output changed after its run, and one without a sidecar", () => {
    const out = output("changed.tsv", {});
    writeFileSync(out, "margin\n0.055\n");
    const bare = path.join(dir, "bare.tsv");
    writeFileSync(bare, "");
    expect(checkProvenance([out, bare], root)).toEqual([
      expect.stringMatching(/output's sha256 differs/),
      expect.stringMatching(/no sidecar/),
    ]);
  });
});
