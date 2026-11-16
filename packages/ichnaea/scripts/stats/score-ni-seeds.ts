// The seed manifest of stage 1 of the score non-inferiority study, enumerated from the generator
// definitions before any run. It asserts that no seed occurs twice, that none lies in a range of
// the score type-I study (Part A) or of the binary one-trial study, and that the seed rules' bounds
// hold (c < 100,000 per generator, c′ < 10,000, s < 1,000). It prints the count and the largest c′,
// and writes the manifest that is committed with the results.
//   node scripts/stats/score-ni-seeds.ts validation/score-ni-seeds.json
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

import {
  cells as typeICells,
  G2_REFINE_STEPS,
  G2_REFINE_WORST,
  G2_STRUCTURES,
} from "./score-type-i-points.ts";
import {
  G2_NI_REFINE_STEPS,
  G2_NI_REFINE_WORST,
  G2_NI_STRUCTURES,
  niCells,
} from "./score-ni-points.ts";

/** The binary one-trial study's seeds: 5,000,000 + 1,000·f + the index of k (24 values of k). */
const BINARY_ONE_TRIAL = [1, 2].flatMap((f) =>
  Array.from({ length: 24 }, (_seed, i) => 5_000_000 + 1_000 * f + i),
);

export interface SeedManifest {
  /** The runtime that enumerated the seeds; the study's shards record theirs too. */
  readonly runtime: { readonly node: string; readonly platform: string; readonly arch: string };
  readonly count: number;
  readonly largestCellIndex: number;
  readonly ranges: readonly {
    readonly name: string;
    readonly from: number;
    readonly to: number;
    readonly count: number;
  }[];
  /** sha256 of the sorted seeds, one decimal per line. */
  readonly sha256: string;
}

/** Every seed of stage 1: screening and confirmation per point, refinement steps reserved, and the structure streams. */
export function stageOneSeeds(): { seeds: Map<number, string>; largestCellIndex: number } {
  const seeds = new Map<number, string>();
  const add = (seed: number, owner: string): void => {
    if (!Number.isInteger(seed)) throw new Error(`${owner}: seed ${seed} is not an integer`);
    const other = seeds.get(seed);
    if (other !== undefined) throw new Error(`seed ${seed} occurs twice: ${other} and ${owner}`);
    seeds.set(seed, owner);
  };
  let largestCellIndex = -1;
  for (const cell of niCells()) {
    for (const p of cell.points) {
      add(p.seed, p.id);
      add(p.confirmSeed, `${p.id} confirmation`);
      if (p.generator !== 2) {
        const c = (p.seed - 30_000_000) % 100_000;
        if (c >= 100_000) throw new Error(`${p.id}: c ${c} is not below 100,000`);
      }
    }
    if (cell.refine !== undefined) {
      const cPrime = cell.cellIndex;
      if (cPrime === undefined) throw new Error(`${cell.id}: a G2 cell without its index`);
      {
        if (cPrime >= 10_000) throw new Error(`${cell.id}: c′ ${cPrime} is not below 10,000`);
        largestCellIndex = Math.max(largestCellIndex, cPrime);
        add(30_200_000 + cPrime, `${cell.id} structure stream`);
        // Refinement steps take s from 100 to 119 when the cell runs; reserve them now.
        for (
          let s = G2_NI_STRUCTURES;
          s < G2_NI_STRUCTURES + G2_NI_REFINE_WORST * G2_NI_REFINE_STEPS;
          s++
        ) {
          if (s >= 1_000) throw new Error(`${cell.id}: s ${s} is not below 1,000`);
          add(50_000_000 + 1_000 * cPrime + s, `${cell.id} refinement ${s}`);
          add(60_000_000 + 1_000 * cPrime + s, `${cell.id} refinement ${s} confirmation`);
        }
      }
    }
  }
  return { seeds, largestCellIndex };
}

/** Every seed of the earlier studies, which stage 1 must not touch. */
export function earlierSeeds(): Set<number> {
  const out = new Set<number>(BINARY_ONE_TRIAL);
  for (const cell of typeICells()) {
    for (const p of cell.points) for (const s of [p.seed, p.confirmSeed, p.recheckSeed]) out.add(s);
    if (cell.refine !== undefined) {
      const first = cell.points[0];
      if (first === undefined) continue;
      const cPrime = Math.floor((first.seed - 10_000_000) / 1_000);
      out.add(2_000_000 + 1_000 * 2 + cPrime);
      for (let s = G2_STRUCTURES; s < G2_STRUCTURES + G2_REFINE_WORST * G2_REFINE_STEPS; s++)
        for (const base of [10_000_000, 20_000_000, 25_000_000]) out.add(base + 1_000 * cPrime + s);
    }
  }
  return out;
}

export function manifest(): SeedManifest {
  const { seeds, largestCellIndex } = stageOneSeeds();
  const earlier = earlierSeeds();
  let earliest = Number.POSITIVE_INFINITY;
  let latestEarlier = 0;
  for (const s of earlier) latestEarlier = Math.max(latestEarlier, s);
  for (const s of seeds.keys()) {
    earliest = Math.min(earliest, s);
    if (earlier.has(s)) throw new Error(`seed ${s} (${seeds.get(s)}) belongs to an earlier study`);
  }
  // The blocks themselves are disjoint, not only the seeds: every earlier seed is below 30,000,000.
  if (!(latestEarlier < 30_000_000 && earliest >= 30_000_000))
    throw new Error(
      `the blocks overlap: earlier seeds reach ${latestEarlier}, stage 1 starts at ${earliest}`,
    );
  const sorted = [...seeds.keys()].toSorted((a, b) => a - b);
  const blocks = [
    ["non-G2 screening", 30_000_000, 30_199_999],
    ["G2 structure streams", 30_200_000, 30_299_999],
    ["non-G2 screening (g ≥ 3)", 30_300_000, 39_999_999],
    ["non-G2 confirmation", 40_000_000, 49_999_999],
    ["G2 simulation", 50_000_000, 59_999_999],
    ["G2 confirmation", 60_000_000, 69_999_999],
  ] as const;
  const ranges = blocks.map(([name, lo, hi]) => {
    const inside = sorted.filter((s) => s >= lo && s <= hi);
    return { name, from: inside[0] ?? lo, to: inside.at(-1) ?? lo, count: inside.length };
  });
  if (ranges.reduce((a, r) => a + r.count, 0) !== sorted.length)
    throw new Error("a seed lies outside every block");
  return {
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    count: sorted.length,
    largestCellIndex,
    ranges,
    sha256: createHash("sha256")
      .update(`${sorted.join("\n")}\n`)
      .digest("hex"),
  };
}

if (import.meta.main) {
  const m = manifest();
  console.log(
    `${m.count} seeds, all distinct and outside the earlier studies; largest c′ ${m.largestCellIndex}`,
  );
  for (const r of m.ranges) console.log(`  ${r.name}: ${r.count} from ${r.from} to ${r.to}`);
  const out = process.argv[2];
  if (out !== undefined) writeFileSync(out, `${JSON.stringify(m, null, 2)}\n`);
}
