// Stage 1 of the score non-inferiority study (VALIDATION.md, "Score measures: non-inferiority"),
// one shard at a time. Two phases, each sharded:
//
//   node --import ./scripts/stats/record-loads.ts scripts/stats/study-score-ni.ts \
//     screen --shard 3/80 --out results/
//     Screens every point of the shard's cells at ICHNAEA_SIM_REPS repetitions (6,000) and refines
//     each G2 cell around its worst structures. Every repetition evaluates all method settings on
//     one data set. Writes screen-3-of-80.tsv.
//
//   node --import ./scripts/stats/record-loads.ts scripts/stats/study-score-ni.ts \
//     confirm --points results/confirm.json --shard 3/20 --out results/
//     Runs the points that the collector selected from their confirmation seeds, in blocks of
//     50,000 repetitions, until every selectable setting's standard error at its own estimate is at
//     most 0.0005, or at most 1,000,000 repetitions, where the row records that it was capped.
//     Writes confirm-3-of-20.tsv.
//
// In both phases, every hundredth repetition is also computed with the full bounds (the shipped
// root-finder for the score settings), and a disagreement with the study's decision stops the run.
// Each output has a sidecar `<output>.meta.json` (scripts/stats/provenance.ts).
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRng, type Rng } from "../../src/stats/rng.ts";
import { boundSC, scoreBound } from "../../src/stats/score-interval.ts";
import type { CaseScores } from "../../src/stats/score-permutation-core.ts";
import { provenance, writeMeta } from "./provenance.ts";
import { runtime } from "./study-score-type-i.ts";
import {
  events,
  G2_NI_REFINE_WORST,
  G2_NI_STRUCTURES,
  LEVEL,
  type NiCell,
  type NiPoint,
  niCells,
  niPointById,
  niShardOf,
  SETTINGS,
} from "./score-ni-points.ts";

/** Screening repetitions: 6,000 in the study; a smaller value is a smoke run, which the collector refuses. */
export const SCREEN_REPS: number = Number(process.env["ICHNAEA_SIM_REPS"] ?? 6000);
/**
 * A confirmation runs until every selectable setting's standard error at its own estimate is at
 * most this: 0.0005 in the study.
 */
export const CONFIRM_SE: number = Number(process.env["ICHNAEA_CONFIRM_SE"] ?? 0.0005);
/** Repetitions per confirmation block: 50,000 in the study; a smaller value is a smoke run. */
export const CONFIRM_BLOCK: number = Number(process.env["ICHNAEA_CONFIRM_BLOCK"] ?? 50_000);
/** The most repetitions a confirmation runs: 1,000,000 in the study. A point that reaches it is capped. */
export const CONFIRM_CAP: number = Number(process.env["ICHNAEA_CONFIRM_CAP"] ?? 1_000_000);
/** One repetition in this many is also computed with the full bounds. */
export const GUARD_EVERY = 100;

export const SCREEN_COLUMNS = [
  "id",
  "generator",
  "family",
  "k",
  "pattern",
  "margin",
  "truth",
  "seed",
  "reported",
  "reps",
  "events",
  "c",
  "noisy_share",
  "structure",
] as const;
export const CONFIRM_COLUMNS = ["id", "confirm_seed", "reps", "events", "capped"] as const;

/** The settings whose bound is at most −margin on one data set, checked against the full bounds every GUARD_EVERY-th time. */
function evaluate(point: NiPoint, data: CaseScores[], guarded: boolean): boolean[] {
  const ev = events(data, point.margin);
  if (guarded)
    SETTINGS.forEach((s, i) => {
      const full =
        s.phi === "t"
          ? ((b) => b === null || b <= -point.margin)(boundSC(data, LEVEL))
          : scoreBound(data, LEVEL, s.phi(data)) <= -point.margin;
      if (full !== ev[i])
        throw new Error(
          `guard: ${point.id}, setting ${s.name}: the study's decision ${ev[i]} differs from the bound's ${full}; data ${JSON.stringify(data)}`,
        );
    });
  return ev;
}

/**
 * Adds the event counts of `reps` more repetitions from `rng` to `counts`; `done` repetitions
 * ran before, so the guard keeps its every-GUARD_EVERY-th stride across blocks.
 */
function addCounts(point: NiPoint, rng: Rng, reps: number, done: number, counts: number[]): void {
  for (let r = done; r < done + reps; r++) {
    const ev = evaluate(point, point.draw(rng), r % GUARD_EVERY === 0);
    ev.forEach((e, i) => {
      if (e) counts[i] = (counts[i] as number) + 1;
    });
  }
}

/** Counts of the event per setting over `reps` repetitions from `seed`. */
function count(point: NiPoint, seed: number, reps: number): number[] {
  const counts = SETTINGS.map(() => 0);
  addCounts(point, createRng(seed), reps, 0, counts);
  return counts;
}

/** The settings whose standard error drives the confirmation's stop: the selectable ones. */
const SELECTABLE = SETTINGS.flatMap((s, i) => (s.role === "candidate" ? [i] : []));

/** Whether every selectable setting's standard error at its own estimate is at most `target`. */
export const selectableSeWithin = (
  counts: readonly number[],
  reps: number,
  target: number,
): boolean =>
  SELECTABLE.every((i) => {
    const p = (counts[i] as number) / reps;
    return Math.sqrt((p * (1 - p)) / reps) <= target;
  });

/**
 * The confirmation's stopping rule: blocks of `block` repetitions, from `runBlock` (which adds a
 * block's counts), until every selectable setting's standard error at its own estimate is at most
 * `target`, or `cap` repetitions have run: then the point is capped. Must-fail and reported
 * settings never drive the stop; their standard errors are reported as they are. At 1,000,000
 * repetitions the binomial standard error is at most 0.0005 at any estimate, so a capped point is
 * one whose selectable coverage lies near 0.5 (about 0.39 to 0.61), far below the bar. A block or
 * cap that is not a positive whole number is refused before any block runs: a block of 0 would
 * never advance.
 */
export function confirmUntil(
  runBlock: (counts: number[], done: number, reps: number) => void,
  block: number,
  cap: number,
  target: number,
): { counts: number[]; reps: number; capped: boolean } {
  for (const [name, value] of [
    ["block (ICHNAEA_CONFIRM_BLOCK)", block],
    ["cap (ICHNAEA_CONFIRM_CAP)", cap],
  ] as const)
    if (!(Number.isSafeInteger(value) && value > 0))
      throw new RangeError(
        `the confirmation ${name} must be a positive whole number, got ${value}`,
      );
  const counts = SETTINGS.map(() => 0);
  let reps = 0;
  do {
    const n = Math.min(block, cap - reps);
    runBlock(counts, reps, n);
    reps += n;
  } while (reps < cap && !selectableSeWithin(counts, reps, target));
  return { counts, reps, capped: reps >= cap };
}

/** The coverage of the worst candidate-role setting, from event counts at truth −margin. */
const worstCoverage = (counts: readonly number[], reps: number): number =>
  Math.min(
    ...SETTINGS.flatMap((s, i) => (s.role === "candidate" ? [(counts[i] as number) / reps] : [])),
  );

function parseShard(text: string | undefined): { index: number; count: number } {
  const m = /^(\d+)\/(\d+)$/.exec(text ?? "");
  const index = Number(m?.[1]);
  const total = Number(m?.[2]);
  if (!m || !(total >= 1 && index >= 0 && index < total))
    throw new RangeError(`--shard must be i/n with 0 ≤ i < n, got ${text}`);
  return { index, count: total };
}

const argument = (args: readonly string[], name: string): string | undefined => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};

/** What GitHub's runner says about itself; empty outside Actions. */
const runner = (): Record<string, string> =>
  Object.fromEntries(
    [
      "ImageOS",
      "ImageVersion",
      "RUNNER_OS",
      "RUNNER_ARCH",
      "GITHUB_RUN_ID",
      "GITHUB_RUN_ATTEMPT",
    ].flatMap((k) => (process.env[k] === undefined ? [] : [[k, process.env[k] as string]])),
  );

const local = (file: string): string => fileURLToPath(new URL(file, import.meta.url));

function row(point: NiPoint, reps: number, counts: readonly number[]): string {
  return `${[
    point.id,
    point.generator,
    point.family,
    point.shape.k,
    point.shape.pattern,
    point.margin,
    point.truth,
    point.seed,
    point.reported,
    reps,
    counts.join(","),
    point.params["c"] ?? "",
    point.params["noisyShare"] ?? "",
    (point.params["structure"] as string | undefined) ?? "",
  ].join("\t")}\n`;
}

function screen(args: readonly string[]): void {
  const { index, count: shards } = parseShard(argument(args, "--shard"));
  const dir = argument(args, "--out") ?? "results";
  mkdirSync(dir, { recursive: true });
  const output = path.join(dir, `screen-${index}-of-${shards}.tsv`);
  const meta = provenance(local("./study-score-ni.ts"), 30_000_000, [...args]);
  const mine: NiCell[] = niShardOf(niCells(), index, shards);
  let points = 0;
  const extra = (): Record<string, unknown> => ({
    phase: "screen",
    shard: { index, count: shards },
    cells: mine.length,
    points,
    reps: SCREEN_REPS,
    confirmSe: CONFIRM_SE,
    guardEvery: GUARD_EVERY,
    settings: SETTINGS.map((s) => s.name),
    runtime: runtime(),
    runner: runner(),
  });
  writeFileSync(output, `${SCREEN_COLUMNS.join("\t")}\n`);
  writeMeta(output, meta, false, extra());
  for (const cell of mine) {
    const screened = cell.points.map((point) => ({
      point,
      counts: count(point, point.seed, SCREEN_REPS),
    }));
    if (cell.refine && screened.length > 0) {
      const worst = screened
        .toSorted(
          (a, b) => worstCoverage(a.counts, SCREEN_REPS) - worstCoverage(b.counts, SCREEN_REPS),
        )
        .slice(0, G2_NI_REFINE_WORST);
      for (const point of cell.refine(
        worst.map((w) => w.point),
        G2_NI_STRUCTURES,
      ))
        screened.push({ point, counts: count(point, point.seed, SCREEN_REPS) });
    }
    for (const { point, counts } of screened)
      appendFileSync(output, row(point, SCREEN_REPS, counts));
    points += screened.length;
    if (screened.length > 0) console.log(`${cell.id}: ${screened.length} point(s)`);
  }
  writeMeta(output, meta, true, extra());
}

function confirm(args: readonly string[]): void {
  const { index, count: shards } = parseShard(argument(args, "--shard"));
  const dir = argument(args, "--out") ?? "results";
  const list = argument(args, "--points");
  if (list === undefined) throw new RangeError("--points is required");
  mkdirSync(dir, { recursive: true });
  const output = path.join(dir, `confirm-${index}-of-${shards}.tsv`);
  const meta = provenance(local("./study-score-ni.ts"), 40_000_000, [...args]);
  const listText = readFileSync(list, "utf8");
  const selected = (
    JSON.parse(listText) as { points: { id: string; structure?: string }[] }
  ).points.filter((_point, i) => i % shards === index);
  // The collector checks that every shard ran the list it rebuilds from the screen outputs.
  const pointsSha256 = createHash("sha256").update(listText).digest("hex");
  const byCell = new Map(niCells().map((cell) => [cell.id, cell]));
  const extra = (): Record<string, unknown> => ({
    phase: "confirm",
    shard: { index, count: shards },
    points: selected.length,
    pointsSha256,
    // The block: each row records its own repetitions, a multiple of it.
    reps: CONFIRM_BLOCK,
    confirmSe: CONFIRM_SE,
    confirmCap: CONFIRM_CAP,
    guardEvery: GUARD_EVERY,
    settings: SETTINGS.map((s) => s.name),
    runtime: runtime(),
    runner: runner(),
  });
  writeFileSync(output, `${CONFIRM_COLUMNS.join("\t")}\n`);
  writeMeta(output, meta, false, extra());
  for (const s of selected) {
    const point = niPointById(byCell, s.id, s.structure);
    const rng = createRng(point.confirmSeed);
    const { counts, reps, capped } = confirmUntil(
      (c, done, n) => addCounts(point, rng, n, done, c),
      CONFIRM_BLOCK,
      CONFIRM_CAP,
      CONFIRM_SE,
    );
    appendFileSync(
      output,
      `${[point.id, point.confirmSeed, reps, counts.join(","), capped].join("\t")}\n`,
    );
    console.log(`${point.id}: confirmed at ${reps} repetitions${capped ? " (capped)" : ""}`);
  }
  writeMeta(output, meta, true, extra());
}

if (import.meta.main) {
  const [phase, ...args] = process.argv.slice(2);
  if (phase === "screen") screen(args);
  else if (phase === "confirm") confirm(args);
  else throw new RangeError(`the phase must be "screen" or "confirm", got ${phase}`);
}
