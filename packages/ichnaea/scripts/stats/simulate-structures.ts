// Coverage of the fixed-cases lower bound by simulation, for structures too large to enumerate:
// the skip logs of scripts/study-heterogeneous.ts and the suites of scripts/generate-structures.ts.
// Each structure is judged on its own by the two-stage rule of `judge` and `COVERAGE` in
// test/support/simulate.ts (VALIDATION.md, "The bar"):
//   1. screen at REPS (6,000) repetitions; the structure passes at ≥ 0.94 + 2·SE;
//   2. confirm every other structure (a candidate) from an independent stream, the seed plus
//      CONFIRM_SEED_OFFSET (100,000), until its SE is at most 0.0005; it fails if
//      estimate + 3·SE < 0.94.
// A structure's grid-mean result is not used: each structure is a point of its own.
//
// A repetition draws every case's successes in both arms (Bernoulli trials, case by case in group
// order, candidate then base) and covers when the one-sided 95% lower bound of `fixedCasesInterval`
// is at most the true mean difference `truthOfGroups(groups)` (+1e-12), as `exactGroupCoverage`
// counts it. The truth must be -margin.
//
// Seeds: the structure at index i (its line number from 0, over the inputs in the order given) gets
// seed B + i + 100,000·⌊i / 100,000⌋. Screening seeds then fill blocks of 100,000 and the
// confirmation seeds (+100,000) the gaps between them, so no two streams share a seed.
//
// Usage, one process per worker, structures i ≡ worker (mod workers):
//   node scripts/simulate-structures.ts <input.jsonl>... --out <out.tsv> --seed-base B \
//     [--worker i --workers n] [--min-k K] > <log>
// The TSV gets one row per structure, written as soon as it is judged. A run that stops resumes:
// rerun the same command and it skips every id already in the TSV. Its sidecar <out.tsv>.meta.json
// records the commit, the sha256 of this script and its local modules, the seed base, the
// arguments and the sha256 of each input; a resumed run must match all of them. The standard
// output gets the table that `judge` prints for each structure.
//   --min-k K   judges only structures with at least K cases (the others keep their index).
//   --count     judges nothing: prints how many structures the shard has, how many are done, by
//               cell, and screens --sample N of them (default 20) at REPS repetitions to time a
//               repetition and to estimate how many need confirming.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { fixedCasesInterval, type CaseCounts } from "../../src/stats/compare.ts";
import type { Rng } from "../../src/stats/rng.ts";
import { type Group, truthOfGroups } from "../../test/stats/support/exact.ts";
import {
  binomial,
  CONFIRM_SE,
  CONFIRM_SEED_OFFSET,
  COVERAGE,
  estimate,
  judge,
  REPS,
} from "../../test/stats/support/simulate.ts";
import { metaPath, provenance, sha256, writeMeta } from "./provenance.ts";

/** One structure to judge, as a JSON line. Other members (phase, seed, family) are kept out. */
export interface StructureLine {
  readonly id: string;
  readonly margin: number;
  readonly k: number;
  readonly r: 2 | 3 | "2/3";
  readonly cell: string;
  readonly groups: readonly Group[];
}

const isRate = (x: unknown): x is number => typeof x === "number" && x >= 0 && x <= 1;
const isCount = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 1;
const plain = (x: unknown): x is string => typeof x === "string" && x !== "" && !/[\t\n\r]/.test(x);

/** Parses and checks one JSON line. Throws on anything but a structure whose truth is -margin. */
export function parseStructure(line: string): StructureLine {
  const value: unknown = JSON.parse(line);
  if (typeof value !== "object" || value === null) throw new TypeError("not an object");
  const v = value as Record<string, unknown>;
  const { id, margin, k, r, cell, groups } = v;
  if (!plain(id)) throw new TypeError("id must be a string without tabs or line breaks");
  if (typeof margin !== "number" || !(margin > 0 && margin < 1))
    throw new TypeError(`${id}: margin must lie in (0, 1)`);
  if (r !== 2 && r !== 3 && r !== "2/3") throw new TypeError(`${id}: r must be 2, 3 or "2/3"`);
  if (!plain(cell)) throw new TypeError(`${id}: cell must be a string without tabs`);
  if (!Array.isArray(groups) || groups.length === 0)
    throw new TypeError(`${id}: groups must be a non-empty array`);
  const parsed = groups.map((g: unknown): Group => {
    const x = (typeof g === "object" && g !== null ? g : {}) as Record<string, unknown>;
    const { count, base, candidate, baseTrials, candidateTrials } = x;
    if (
      !isCount(count) ||
      !isRate(base) ||
      !isRate(candidate) ||
      !isCount(baseTrials) ||
      !isCount(candidateTrials)
    )
      throw new TypeError(`${id}: a group needs count, rates in [0, 1] and trials of at least 1`);
    return { count, base, candidate, baseTrials, candidateTrials };
  });
  if (parsed.reduce((a, g) => a + g.count, 0) !== k)
    throw new TypeError(`${id}: k must equal the cases in its groups`);
  if (Math.abs(truthOfGroups(parsed) + margin) > 1e-9)
    throw new RangeError(`${id}: the true mean difference is not -margin`);
  return { id, margin, k: k as number, r, cell, groups: parsed };
}

/** The screening seed of the structure at `index`; its confirmation adds CONFIRM_SEED_OFFSET. */
export function seedOf(base: number, index: number): number {
  const seed = base + index + CONFIRM_SEED_OFFSET * Math.floor(index / CONFIRM_SEED_OFFSET);
  if (!Number.isInteger(seed) || seed < 1 || seed + CONFIRM_SEED_OFFSET > 2 ** 32 - 1)
    throw new RangeError(`seed ${seed} of structure ${index} is outside [1, 2^32 - 1]`);
  return seed;
}

/** One repetition: draws every case's outcomes and returns whether the lower bound covers. */
export function coverageRun(groups: readonly Group[]): (rng: Rng) => boolean {
  const truth = truthOfGroups(groups);
  const cases = groups.flatMap((g) => Array.from({ length: g.count }, () => g));
  const ids = cases.map((_, i) => `c${String(i).padStart(3, "0")}`);
  return (rng) => {
    const drawn: CaseCounts[] = cases.map((g, i) => ({
      id: ids[i] as string,
      candidate: {
        successes: binomial(rng, g.candidateTrials, g.candidate),
        trials: g.candidateTrials,
      },
      base: { successes: binomial(rng, g.baseTrials, g.base), trials: g.baseTrials },
    }));
    return fixedCasesInterval(drawn, 0.95).interval.lower <= truth + 1e-12;
  };
}

export const HEADER: string = "id\tmargin\tk\tr\tcell\tstage\testimate\tse\treps\tresult\tseed";

/** Judges one structure by the two-stage rule and returns its TSV row. */
export function judgeStructure(s: StructureLine, seed: number): string {
  const verdict = judge([{ label: s.id, seed, run: coverageRun(s.groups) }], COVERAGE, s.id);
  const e = verdict.estimates[0];
  if (!e) throw new Error(`${s.id}: no estimate`);
  // The grid-mean check of `judge` is for grids; a structure fails only on its own point.
  const failed = verdict.failures.some((f) => f.startsWith(`${s.id}: `));
  return [
    s.id,
    s.margin.toFixed(3),
    s.k,
    s.r,
    s.cell,
    e.stage,
    e.value.toFixed(6),
    e.se.toFixed(6),
    e.reps,
    failed ? "fail" : "pass",
    seed,
  ].join("\t");
}

/** Every structure of the inputs, in order, with its index. Ids must be unique. */
export function readStructures(
  inputs: readonly string[],
): Array<{ index: number; s: StructureLine }> {
  const seen = new Set<string>();
  const out: Array<{ index: number; s: StructureLine }> = [];
  for (const input of inputs)
    for (const line of readFileSync(input, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      const s = parseStructure(line);
      if (seen.has(s.id)) throw new Error(`structure id ${s.id} appears twice`);
      seen.add(s.id);
      out.push({ index: out.length, s });
    }
  return out;
}

/**
 * The ids already judged in a TSV. A last line cut off by a stopped run (no line break) does not
 * count; with `repair` it is also removed from the file, so the structure runs again.
 */
export function doneIds(out: string, repair = true): Set<string> {
  if (!existsSync(out)) return new Set();
  let text = readFileSync(out, "utf8");
  if (text !== "" && !text.endsWith("\n")) {
    text = text.slice(0, text.lastIndexOf("\n") + 1);
    if (repair) writeFileSync(out, text);
  }
  const lines = text.split("\n").filter((l) => l !== "");
  if (lines[0] !== HEADER) throw new Error(`${out} is not an output of this script`);
  return new Set(lines.slice(1).map((l) => l.split("\t")[0] as string));
}

export interface Shard {
  readonly seedBase: number;
  readonly worker: number;
  readonly workers: number;
  readonly minK: number;
}

/** The structures of a shard, in index order. */
export const shardOf = (
  all: ReadonlyArray<{ index: number; s: StructureLine }>,
  shard: Shard,
): Array<{ index: number; s: StructureLine }> =>
  all.filter(({ index, s }) => index % shard.workers === shard.worker && s.k >= shard.minK);

/**
 * Judges every structure of the shard that the TSV does not hold yet, appending a row each.
 * Returns how many it judged.
 */
export function runShard(
  all: ReadonlyArray<{ index: number; s: StructureLine }>,
  shard: Shard,
  out: string,
): number {
  const done = doneIds(out);
  if (!existsSync(out)) writeFileSync(out, `${HEADER}\n`);
  let judged = 0;
  for (const { index, s } of shardOf(all, shard)) {
    if (done.has(s.id)) continue;
    appendFileSync(out, `${judgeStructure(s, seedOf(shard.seedBase, index))}\n`);
    judged++;
  }
  return judged;
}

/** Prints the --count probe of a shard: counts by cell and a timed screening sample. */
function probe(
  all: ReadonlyArray<{ index: number; s: StructureLine }>,
  shard: Shard,
  out: string,
  sample: number,
): void {
  const mine = shardOf(all, shard);
  const done = doneIds(out, false);
  const todo = mine.filter(({ s }) => !done.has(s.id));
  const cells = new Map<string, number>();
  for (const { s } of todo) cells.set(s.cell, (cells.get(s.cell) ?? 0) + 1);
  console.log(
    `structures ${all.length}, in shard ${mine.length}, done ${mine.length - todo.length}, to run ${todo.length}`,
  );
  for (const [cell, n] of [...cells].toSorted(([a], [b]) =>
    a.localeCompare(b, undefined, { numeric: true }),
  ))
    console.log(`  ${cell}\t${n}`);
  const size = Math.min(sample, todo.length);
  if (size === 0) return;
  // Milliseconds per repetition and case, from screening the sample.
  let ms = 0;
  let caseReps = 0;
  let candidates = 0;
  for (let i = 0; i < size; i++) {
    const { index, s } = todo[Math.floor((i * todo.length) / size)] as (typeof todo)[number];
    const start = performance.now();
    const value = estimate(coverageRun(s.groups), seedOf(shard.seedBase, index), REPS);
    ms += performance.now() - start;
    caseReps += REPS * s.k;
    if (!COVERAGE.clears(value, Math.sqrt((value * (1 - value)) / REPS))) candidates++;
  }
  const perCaseRep = ms / caseReps;
  const screen = todo.reduce((a, { s }) => a + REPS * s.k * perCaseRep, 0) / 1000;
  // A candidate near 0.945 needs about 0.052 / CONFIRM_SE² repetitions, in batches of 50,000.
  const confirmReps = Math.ceil((0.945 * 0.055) / CONFIRM_SE ** 2 / 50_000) * 50_000;
  const meanK = todo.reduce((a, { s }) => a + s.k, 0) / todo.length;
  const perCandidate = (confirmReps * meanK * perCaseRep) / 1000;
  const share = candidates / size;
  console.log(
    [
      `sample ${size} at ${REPS} repetitions: ${(ms / 1000).toFixed(1)} s, ${(perCaseRep * 1000).toFixed(3)} µs per case and repetition, ${candidates} candidates`,
      `screening: ${(screen / 3600).toFixed(2)} h`,
      `confirming: ${confirmReps} repetitions per candidate, ${perCandidate.toFixed(0)} s at the mean k ${meanK.toFixed(1)}`,
      `predicted: ${((screen + share * todo.length * perCandidate) / 3600).toFixed(2)} h at the sample's candidate share ${share.toFixed(3)}; ${((screen + 0.05 * todo.length * perCandidate) / 3600).toFixed(2)} h at 0.05`,
    ].join("\n"),
  );
}

function main(): void {
  const args = process.argv.slice(2);
  const { values, positionals: inputs } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      out: { type: "string" },
      "seed-base": { type: "string" },
      worker: { type: "string", default: "0" },
      workers: { type: "string", default: "1" },
      "min-k": { type: "string", default: "1" },
      count: { type: "boolean", default: false },
      sample: { type: "string", default: "20" },
    },
  });
  const { out } = values;
  if (out === undefined || inputs.length === 0)
    throw new Error("usage: simulate-structures.ts <input.jsonl>... --out <out.tsv> --seed-base B");
  if (values["seed-base"] === undefined) throw new Error("give the seed base with --seed-base");
  const shard: Shard = {
    seedBase: Number(values["seed-base"]),
    worker: Number(values.worker),
    workers: Number(values.workers),
    minK: Number(values["min-k"]),
  };
  if (!(shard.workers >= 1 && shard.worker >= 0 && shard.worker < shard.workers))
    throw new RangeError("--worker must lie in [0, --workers)");
  if (REPS !== 6000) throw new Error(`screening must run 6,000 repetitions, not ${REPS}`);
  const all = readStructures(inputs);
  if (all.length > 0) seedOf(shard.seedBase, all.length - 1);
  if (values.count) {
    probe(all, shard, out, Number(values.sample));
    return;
  }
  const here = import.meta.dirname;
  const p = provenance(
    import.meta.filename,
    [
      path.join(here, "../../test/stats/support/exact.ts"),
      path.join(here, "../../test/stats/support/simulate.ts"),
      path.join(here, "provenance.ts"),
    ],
    shard.seedBase,
    args,
  );
  const extra = {
    kind: "simulation",
    inputs: inputs.map((f) => ({ path: path.basename(f), sha256: sha256(readFileSync(f)) })),
    shard,
    reps: REPS,
    confirmSe: CONFIRM_SE,
    confirmSeedOffset: CONFIRM_SEED_OFFSET,
    seeds: `${shard.seedBase} + i + ${CONFIRM_SEED_OFFSET}·⌊i / ${CONFIRM_SEED_OFFSET}⌋, confirmations +${CONFIRM_SEED_OFFSET}, MT19937`,
  };
  let sessions: unknown[] = [];
  if (existsSync(out)) {
    // A resumed run must be the same run: same code, seeds, inputs and shard.
    const before = JSON.parse(readFileSync(metaPath(out), "utf8")) as Record<string, unknown>;
    const now: Record<string, unknown> = { ...p, ...extra };
    for (const key of ["commit", "files", "seedBase", "inputs", "shard", "reps"])
      if (JSON.stringify(before[key]) !== JSON.stringify(now[key]))
        throw new Error(`${out} was written by another run: its ${key} differs`);
    sessions = Array.isArray(before["sessions"]) ? before["sessions"] : [];
  }
  const session = { started: p.started, arguments: args };
  writeMeta(out, p, false, { ...extra, sessions: [...sessions, session] });
  const judged = runShard(all, shard, out);
  const complete = doneIds(out).size === shardOf(all, shard).length;
  writeMeta(out, p, complete, {
    ...extra,
    sessions: [...sessions, { ...session, finished: new Date().toISOString(), judged }],
  });
  console.error(
    `judged ${judged}; ${complete ? "the shard is complete" : "the shard is not complete"}`,
  );
}

if (import.meta.main) main();
