// The seed manifest of stage 1 of the score non-inferiority study, enumerated from the generator
// definitions before any run. It asserts that no seed occurs twice, that none lies in a range of
// an earlier study (the score type-I study, the binary one-trial study and the binary floor sweep's
// exact phases and simulation sets), that none reaches stage 2's reserved 70,000,000 and
// 80,000,000 bases, and that the seed rules hold (c < 100,000 per generator, c′ < 10,000,
// s < 1,000, G2 at truth 0 below 39,000,000). It prints the count and the largest c′, and writes
// the manifest, with the runtime that enumerated it, that is committed with the results.
//   node scripts/stats/score-ni-seeds.ts validation/score-ni-seeds.json
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

import {
  cells as typeICells,
  G2_REFINE_STEPS,
  G2_REFINE_WORST,
  G2_STRUCTURES,
} from "./score-type-i-points.ts";
import { type Runtime, runtime } from "./study-score-type-i.ts";
import {
  G2_NI_REFINE_STEPS,
  G2_NI_REFINE_WORST,
  G2_NI_STRUCTURES,
  G2_ZERO_BASE,
  G2_ZERO_CONFIRM_BASE,
  niCells,
} from "./score-ni-points.ts";
import { EXACT, SIMULATIONS } from "./sweep-job.ts";

/**
 * The binary floor sweep's seed blocks: each exact phase's base + round(margin × 10,000) for margins
 * 0.05 to 0.30, and each simulation set's base + a structure index below 1,000,000.
 */
export const FLOOR_SWEEP_BLOCKS: readonly { name: string; from: number; to: number }[] = [
  ...Object.entries(EXACT).map(([phase, e]) => ({
    name: `floor sweep, exact phase ${phase}`,
    from: e.seedBase + 500,
    to: e.seedBase + 3_000,
  })),
  ...Object.entries(SIMULATIONS).map(([set, e]) => ({
    name: `floor sweep, simulation set ${set}`,
    from: e.seedBase,
    to: e.seedBase + 999_999,
  })),
];

/** The binary one-trial study's seeds: 5,000,000 + 1,000·f + the index of k (24 values of k). */
const BINARY_ONE_TRIAL = [1, 2].flatMap((f) =>
  Array.from({ length: 24 }, (_seed, i) => 5_000_000 + 1_000 * f + i),
);

export interface SeedManifest {
  /** The runtime that enumerated the seeds; the study's shards record theirs too. */
  readonly runtime: Runtime;
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
        // The rule's own index: c = seed − 30,000,000 − 100,000·g, which must lie in [0, 100,000).
        const c = p.seed - 30_000_000 - 100_000 * p.generator;
        if (!(c >= 0 && c < 100_000)) throw new Error(`${p.id}: c ${c} is not in [0, 100,000)`);
        if (p.confirmSeed - p.seed !== 10_000_000)
          throw new Error(`${p.id}: the confirmation seed is not the screening seed + 10,000,000`);
      } else if (p.truth === "zero") {
        if (!(p.seed >= G2_ZERO_BASE && p.seed < G2_ZERO_BASE + 1_000_000))
          throw new Error(`${p.id}: seed ${p.seed} is outside G2's truth-0 block`);
        if (p.confirmSeed - p.seed !== G2_ZERO_CONFIRM_BASE - G2_ZERO_BASE)
          throw new Error(`${p.id}: the reserved confirmation seed breaks the rule`);
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
  let latest = 0;
  let latestEarlier = 0;
  for (const s of earlier) latestEarlier = Math.max(latestEarlier, s);
  for (const b of FLOOR_SWEEP_BLOCKS) latestEarlier = Math.max(latestEarlier, b.to);
  for (const s of seeds.keys()) {
    earliest = Math.min(earliest, s);
    latest = Math.max(latest, s);
    if (earlier.has(s)) throw new Error(`seed ${s} (${seeds.get(s)}) belongs to an earlier study`);
    const block = FLOOR_SWEEP_BLOCKS.find((b) => s >= b.from && s <= b.to);
    if (block !== undefined)
      throw new Error(`seed ${s} (${seeds.get(s)}) lies in the ${block.name}`);
  }
  // Stage 2 keeps 70,000,000 and 80,000,000, and the equivalence test uses 90,000,000 onwards.
  if (latest >= 70_000_000) throw new Error(`seed ${latest} reaches the reserved 70,000,000`);
  // The blocks themselves are disjoint, not only the seeds: every earlier seed is below 30,000,000.
  if (!(latestEarlier < 30_000_000 && earliest >= 30_000_000))
    throw new Error(
      `the blocks overlap: earlier seeds reach ${latestEarlier}, stage 1 starts at ${earliest}`,
    );
  const sorted = [...seeds.keys()].toSorted((a, b) => a - b);
  const blocks = [
    ["non-G2 screening", 30_000_000, 30_199_999],
    ["G2 structure streams", 30_200_000, 30_299_999],
    ["non-G2 screening (g ≥ 3)", 30_300_000, 37_999_999],
    ["G2 at truth 0, reported", G2_ZERO_BASE, G2_ZERO_BASE + 999_999],
    ["non-G2 confirmation", 40_000_000, 47_999_999],
    [
      "G2 at truth 0, confirmation (reserved, never run)",
      G2_ZERO_CONFIRM_BASE,
      G2_ZERO_CONFIRM_BASE + 999_999,
    ],
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
    runtime: runtime(),
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
    `${m.count} seeds on ${m.runtime.name} ${m.runtime.version} ${m.runtime.platform} ${m.runtime.arch}, all distinct and outside the earlier studies; largest c′ ${m.largestCellIndex}`,
  );
  for (const r of m.ranges) console.log(`  ${r.name}: ${r.count} from ${r.from} to ${r.to}`);
  const out = process.argv[2];
  if (out !== undefined) writeFileSync(out, `${JSON.stringify(m, null, 2)}\n`);
}
