// The exact type-I study of the binary regression test at one trial per case and arm
// (VALIDATION.md, "One trial per case: the binary regression test"). For each k and family it
// computes the exact rejection probability of every structure at a true mean difference of 0, and
// keeps the worst, at the level alpha = 0.05 and at the Holm levels alpha / m for m = 2, 3 and 4. An
// exactly computed point fails above its level (decision 0006).
//   node scripts/stats/study-binary-one-trial.ts validation/binary-one-trial.tsv
import { writeFileSync } from "node:fs";

import { createRng } from "../../src/stats/rng.ts";
import {
  LEVELS,
  exactTypeI,
  noisyCount,
  perturb,
  randomStructure,
  rejectionThresholds,
  type Structure,
} from "./binary-one-trial.ts";
import { provenance, writeMeta } from "./provenance.ts";

export const CASE_COUNTS = [
  5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 25, 30, 40, 60, 100, 146, 200, 300,
] as const;
export const FAMILIES = ["top", "floor"] as const;
type Family = (typeof FAMILIES)[number];
export const RANDOM_STRUCTURES = 2_000;
export const REFINE_WORST = 5;
export const REFINE_ROUNDS = 4;
export const REFINE_STEPS = 5;
export const SEED_BASE = 5_000_000;
/** Seed of one (family, k) cell: 5,000,000 + 1,000·f + the index of k, with f = 1 (top) or 2. */
export const seedOf = (family: Family, kIndex: number): number =>
  SEED_BASE + 1_000 * (FAMILIES.indexOf(family) + 1) + kIndex;

/** The sharp null (both arms at the same rate in every case) and a fixed one-noisy-case grid. */
function fixedStructures(k: number, family: Family): Structure[] {
  const rates = [0.05, 0.2, 0.5, 0.8, 0.95];
  const out: Structure[] = [
    Array.from({ length: k }, (_, i) => [rates[i % 5] as number, rates[i % 5] as number] as const),
  ];
  for (const noisy of [1, 2, 3].filter((n) => n < k))
    for (let step = 0; step < 10; step++)
      for (const share of [0.1, 0.25, 0.5, 0.75, 1]) {
        const base = 0.05 + 0.1 * step;
        const total = share * noisy * (family === "top" ? 1 - base : base);
        const d = total / (k - noisy);
        const stable = Array.from({ length: k - noisy }, () =>
          family === "top" ? ([1, 1 - d] as const) : ([0, d] as const),
        );
        const offset = family === "top" ? total / noisy : -total / noisy;
        out.push([
          ...stable,
          ...Array.from({ length: noisy }, () => [base, base + offset] as const),
        ]);
      }
  return out;
}

interface Row {
  readonly level: number;
  readonly k: number;
  readonly family: Family;
  readonly seed: number;
  readonly structures: number;
  readonly worst: number;
  readonly worstStructure: Structure;
}

const local = (file: string): string => new URL(file, import.meta.url).pathname;

function main(output: string): void {
  const meta = provenance(
    local("./study-binary-one-trial.ts"),
    [
      local("./binary-one-trial.ts"),
      local("../../src/stats/compare.ts"),
      local("../../src/stats/exact-conditional.ts"),
    ],
    SEED_BASE,
    process.argv.slice(2),
  );
  const rows: Row[] = [];
  // Every level searches the same space: each (family, k) keeps its seed at every level.
  for (const level of LEVELS) {
    const thresholds = rejectionThresholds(Math.max(...CASE_COUNTS), level);
    for (const [kIndex, k] of CASE_COUNTS.entries())
      for (const family of FAMILIES) {
        const seed = seedOf(family, kIndex);
        const rng = createRng(seed);
        const scored: { s: Structure; p: number }[] = [];
        const score = (s: Structure): { s: Structure; p: number } => {
          const point = { s, p: exactTypeI(s, thresholds) };
          scored.push(point);
          return point;
        };
        for (const s of fixedStructures(k, family)) score(s);
        for (let i = 0; i < RANDOM_STRUCTURES; i++) score(randomStructure(rng, k, family));
        // Hill-climbing from the worst 5: each round tries a few perturbations and keeps the worst.
        for (const start of scored.toSorted((a, b) => b.p - a.p).slice(0, REFINE_WORST)) {
          let current = start;
          for (let round = 0; round < REFINE_ROUNDS; round++)
            for (let step = 0; step < REFINE_STEPS; step++) {
              const next = perturb(rng, current.s, noisyCount(current.s));
              if (next === undefined) continue;
              const point = score(next);
              if (point.p > current.p) current = point;
            }
        }
        const top = scored.reduce((a, b) => (b.p > a.p ? b : a));
        rows.push({
          level,
          k,
          family,
          seed,
          structures: scored.length,
          worst: top.p,
          worstStructure: top.s,
        });
        console.log(
          `level=${level.toPrecision(4)} k=${k} ${family}: ${scored.length} structures, worst ${top.p.toFixed(6)}${top.p > level ? " FAILS" : ""}`,
        );
      }
  }
  const k1 = Object.fromEntries(
    LEVELS.map((level) => {
      const passes = (k: number): boolean =>
        rows.filter((r) => r.level === level && r.k === k).every((r) => r.worst <= level);
      return [
        level.toPrecision(10),
        CASE_COUNTS.find((_, i) => CASE_COUNTS.slice(i).every(passes)) ?? null,
      ];
    }),
  );
  writeFileSync(
    output,
    `${[
      "level\tk\tfamily\tseed\tstructures\tworst_type_i\tpasses\tworst_structure",
      ...rows.map((r) =>
        [
          r.level.toPrecision(10),
          r.k,
          r.family,
          r.seed,
          r.structures,
          r.worst.toPrecision(10),
          r.worst <= r.level,
          JSON.stringify(r.worstStructure),
        ].join("\t"),
      ),
    ].join("\n")}\n`,
  );
  writeMeta(output, meta, true, { k1 });
  console.log(`k1 per level: ${JSON.stringify(k1)}`);
}

if (import.meta.main) main(process.argv[2] ?? "validation/binary-one-trial.tsv");
