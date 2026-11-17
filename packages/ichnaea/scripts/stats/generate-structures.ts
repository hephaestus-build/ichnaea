// Structures of large suites for scripts/simulate-structures.ts, one JSON line each: the
// heterogeneous-effects family of scripts/study-heterogeneous.ts at sizes too large to enumerate.
// Every structure has stable cases that pass every base trial (base rate 1) and drop under the
// candidate, and one to three noisy cases; the last noisy case's candidate rate is solved (by
// `groupsOf` of the sweep script) so that the mean difference is exactly -margin.
//
// For each margin from --from to --to in steps of --step (default 0.050 to 0.300 by 0.005) and each
// cell, --per-cell structures (default 300):
//   - 121 of the one-noisy-case grid: the noisy case's base rate 0 to 1 in steps of 0.1, and its
//     candidate rate (j + 0.5)/11 for j = 0 to 10, which sets the stable drop;
//   - the rest random: 1 to 3 noisy cases, every noisy rate uniform on [0, 1] (the last noisy
//     case's candidate rate too, which sets the stable drop; a draw that needs a drop outside
//     [0, 1] is drawn again).
// The cells:
//   - k = 20, 30 and 60 with r = 2, 3 and mixed 2/3 ("<k>|<r>"). Mixed counts follow the sweep:
//     3 trials on max(1, round(u·0.6·stable)) stable cases (in the grid a quarter or half of
//     them), 2 on the others, and 2 or 3 on each noisy case with equal odds;
//   - two fixed layouts ("<k>|<t>x3"): 60 cases with 17 at 3 trials and 43 at 2, and 52 cases with
//     9 at 3 and 43 at 2. A noisy case runs 3 trials with probability t/k (in the grid, the last
//     noisy case alternates), and the stable cases fill the rest of the layout;
//   - with --one-trial, each cell again with one-trial cells ("<cell>+1t"): 1 to ⌊k/5⌋ case-arm
//     cells, so at most 10% of the 2k, run 1 trial (`oneTrialOf` of the sweep script; in the grid
//     ⌊k/5⌋ stable cells, all in the candidate arm or all in the base arm).
// Seeds: the cell j of margin index i draws from MT19937 seeded with B + 1,000·i + j, where B is
// --seed-base (default 7,000,000). The default seeds (7,000,000 to 7,050,021) overlap no seed of
// the sweeps or of the simulation runs.
// Usage: node scripts/generate-structures.ts --out <structures.jsonl> [--one-trial]
// The output must not exist; its sidecar <out>.meta.json records the provenance.
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { createRng } from "../../src/stats/rng.ts";
import type { Group } from "../../test/stats/support/exact.ts";
import { provenance, writeMeta } from "./provenance.ts";
import {
  groupsOf,
  maxOneTrial,
  oneTrialOf,
  type OneTrial,
  type Structure,
} from "./study-heterogeneous.ts";

/** A cell of the suite: k cases with r trials each, or a fixed layout with `atThree` at 3. */
export interface Cell {
  readonly name: string;
  readonly k: number;
  readonly r: 2 | 3 | "2/3";
  /** A fixed layout: exactly this many cases run 3 trials, the others 2. */
  readonly atThree?: number;
  readonly oneTrial: boolean;
}

/** The cells, without and with one-trial cells. */
export function cells(oneTrial: boolean): Cell[] {
  const base: Array<Omit<Cell, "oneTrial">> = [
    ...[20, 30, 60].flatMap((k) =>
      ([2, 3, "2/3"] as const).map((r) => ({ name: `${k}|${r}`, k, r })),
    ),
    { name: "60|17x3", k: 60, r: "2/3", atThree: 17 },
    { name: "52|9x3", k: 52, r: "2/3", atThree: 9 },
  ];
  return [
    ...base.map((c) => ({ ...c, oneTrial: false })),
    ...(oneTrial ? base.map((c) => ({ ...c, name: `${c.name}+1t`, oneTrial: true })) : []),
  ];
}

/** One generated structure, as the runner reads it. */
export interface GeneratedLine {
  readonly id: string;
  readonly margin: number;
  readonly k: number;
  readonly r: 2 | 3 | "2/3";
  readonly cell: string;
  readonly family: "grid" | "random";
  readonly groups: Group[];
}

/**
 * The stable drop that gives the last noisy case the candidate rate `lastCandidate`: the k − n
 * stable cases carry what the noisy cases leave of the total difference −margin·k.
 */
function dropFor(
  k: number,
  margin: number,
  noisy: ReadonlyArray<readonly [number, number]>,
  lastBase: number,
  lastCandidate: number,
): number {
  const noisyDiff = noisy.reduce((a, [b, c]) => a + c - b, 0) + lastCandidate - lastBase;
  return (margin * k + noisyDiff) / (k - noisy.length - 1);
}

/** The structures of one cell at one margin, from the generator `u`. */
export function cellStructures(
  cell: Cell,
  margin: number,
  perCell: number,
  u: () => number,
  idPrefix: string,
): GeneratedLine[] {
  const { k } = cell;
  const lines: GeneratedLine[] = [];
  const push = (s: Structure, family: "grid" | "random"): boolean => {
    const groups = groupsOf(s, margin, Number.POSITIVE_INFINITY);
    if (!groups) return false;
    lines.push({
      id: `${idPrefix}-${lines.length}`,
      margin,
      k,
      r: cell.r,
      cell: cell.name,
      family,
      groups,
    });
    return true;
  };
  /** Stable cases at 3 and noisy trials for a layout or mixed cell. */
  const trials = (noisyTrials: number[], share: number) =>
    cell.atThree !== undefined
      ? { stableAtThree: cell.atThree - noisyTrials.filter((t) => t === 3).length, noisyTrials }
      : cell.r === "2/3"
        ? {
            stableAtThree: Math.max(1, Math.round(share * (k - noisyTrials.length))),
            noisyTrials,
          }
        : { stableAtThree: 0, noisyTrials };
  // The one-noisy-case grid.
  for (let b = 0; b <= 10 && lines.length < perCell; b++)
    for (let j = 0; j <= 10 && lines.length < perCell; j++) {
      const g = b * 11 + j;
      const lastTrials =
        cell.r === "2/3" ? ((cell.atThree !== undefined ? g : g >> 1) % 2 === 0 ? 2 : 3) : cell.r;
      const oneTrial: OneTrial | undefined = cell.oneTrial
        ? (g >> 2) % 2 === 0
          ? { candidate: maxOneTrial(k), base: 0 }
          : { candidate: 0, base: maxOneTrial(k) }
        : undefined;
      const ok = push(
        {
          k,
          r: cell.r,
          ...trials([lastTrials], g % 2 === 0 ? 0.25 : 0.5),
          stableBase: 1,
          drop: dropFor(k, margin, [], b / 10, (j + 0.5) / 11),
          noisy: [],
          lastBase: b / 10,
          ...(oneTrial ? { oneTrial } : {}),
        },
        "grid",
      );
      if (!ok) throw new RangeError(`grid point ${g} of ${cell.name} at ${margin} has no solution`);
    }
  // Random structures.
  while (lines.length < perCell) {
    const n = 1 + Math.floor(u() * 3);
    const noisy = Array.from({ length: n - 1 }, () => [u(), u()] as const);
    const lastBase = u();
    const lastCandidate = u();
    const noisyTrials = Array.from({ length: n }, () =>
      cell.r !== "2/3"
        ? cell.r
        : u() < (cell.atThree !== undefined ? cell.atThree / k : 0.5)
          ? 3
          : 2,
    );
    const share = cell.atThree === undefined && cell.r === "2/3" ? u() * 0.6 : 0;
    const oneTrial = cell.oneTrial ? oneTrialOf(k, u) : undefined;
    const drop = dropFor(k, margin, noisy, lastBase, lastCandidate);
    if (drop < 0 || drop > 1) continue;
    push(
      {
        k,
        r: cell.r,
        ...trials(noisyTrials, share),
        stableBase: 1,
        drop,
        noisy,
        lastBase,
        ...(oneTrial ? { oneTrial } : {}),
      },
      "random",
    );
  }
  return lines;
}

/** Every structure, margin by margin and cell by cell. */
export function generate(
  from: number,
  to: number,
  step: number,
  perCell: number,
  seedBase: number,
  oneTrial: boolean,
): GeneratedLine[] {
  const margins = Math.round((to - from) / step) + 1;
  const all = cells(oneTrial);
  return Array.from({ length: margins }, (_, i) => from + i * step).flatMap((margin, i) =>
    all.flatMap((cell, j) => {
      const rng = createRng(seedBase + 1000 * i + j);
      return cellStructures(
        cell,
        margin,
        perCell,
        () => rng.uniform(),
        `g${seedBase}-${margin.toFixed(3)}-${cell.name}`,
      );
    }),
  );
}

function main(): void {
  const args = process.argv.slice(2);
  const { values } = parseArgs({
    args,
    options: {
      out: { type: "string" },
      from: { type: "string", default: "0.05" },
      to: { type: "string", default: "0.3" },
      step: { type: "string", default: "0.005" },
      "per-cell": { type: "string", default: "300" },
      "seed-base": { type: "string", default: "7000000" },
      "one-trial": { type: "boolean", default: false },
    },
  });
  const { out } = values;
  if (out === undefined) throw new Error("give the output with --out");
  if (existsSync(out)) throw new Error(`${out} exists already; give a new file`);
  const seedBase = Number(values["seed-base"]);
  const perCell = Number(values["per-cell"]);
  if (!Number.isInteger(perCell) || perCell < 121)
    throw new RangeError("--per-cell must hold the 121 grid structures");
  const p = provenance(import.meta.filename, seedBase, args);
  const lines = generate(
    Number(values.from),
    Number(values.to),
    Number(values.step),
    perCell,
    seedBase,
    values["one-trial"],
  );
  writeFileSync(out, "");
  for (let i = 0; i < lines.length; i += 1000)
    appendFileSync(
      out,
      lines
        .slice(i, i + 1000)
        .map((l) => `${JSON.stringify(l)}\n`)
        .join(""),
    );
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(l.cell, (counts.get(l.cell) ?? 0) + 1);
  writeMeta(out, p, true, {
    kind: "structures",
    seeds: `${seedBase} + 1000·(margin index) + (cell index), MT19937`,
    perCell,
    structures: lines.length,
    cells: Object.fromEntries(counts),
  });
  console.error(`${lines.length} structures in ${out}`);
}

if (import.meta.main) main();
