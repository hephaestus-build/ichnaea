// The type-I study of the score permutation test (VALIDATION.md, "Score measures: the regression
// test"), one shard at a time. Two phases, each sharded:
//
//   node --import ./scripts/stats/record-loads.ts scripts/stats/study-score-type-i.ts \
//     screen --shard 3/80 --out results/
//     Screens every point of the shard's cells at ICHNAEA_SIM_REPS repetitions (6,000), counting
//     its rejections at each level from the same repetitions, refines each G2 cell by hill-climbing
//     from its worst structures, and confirms every candidate with its confirmation seed until the
//     standard error is at most 0.0005 at every level. Writes screen-3-of-80.tsv.
//
//   node --import ./scripts/stats/record-loads.ts scripts/stats/study-score-type-i.ts \
//     recheck --points results/recheck.json --shard 3/20 --out results/
//     Re-checks the points that the collector selected at 20,000 repetitions: each repetition draws
//     one data set from the re-check seed and runs both the shipped test (exact, or 10,000 resamples
//     with the rerun near a level) and the study's test on it. Writes recheck-3-of-20.tsv.
//
// Each output has a sidecar `<output>.meta.json` (scripts/provenance.ts) with the commit, the
// script hashes, the arguments, the Node version, the runner image, the phase, the shard and the
// seed range. `scripts/collect-score-type-i.ts` checks completeness and digests and applies the rule.
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRng } from "../../src/stats/rng.ts";
import { provenance, writeMeta } from "./provenance.ts";
import {
  type Cell,
  cells,
  G2_REFINE_ROUNDS,
  G2_REFINE_STEPS,
  G2_REFINE_STEPS_PER_ROUND,
  G2_REFINE_WORST,
  G2_STRUCTURES,
  type Point,
  pointById,
  rejections,
  runTest,
  shardOf,
  shippedTest,
} from "./score-type-i-points.ts";
import {
  confirmationDone,
  failsAtAnyLevel,
  formatCounts,
  LEVELS,
  minConfirmReps,
  needsConfirmation,
  STUDY_RESAMPLES,
  studyRejects,
  worstness,
} from "./score-type-i-rule.ts";

/** Screening repetitions: 6,000 in the study; a smaller value is a smoke run, and the collector refuses it. */
export const SCREEN_REPS: number = Number(process.env["ICHNAEA_SIM_REPS"] ?? 6000);
/** A confirmation runs until its standard error is at most this: 0.0005 in the study. */
export const CONFIRM_SE: number = Number(process.env["ICHNAEA_CONFIRM_SE"] ?? 0.0005);
/** Repetitions of the re-check with the shipped test (SE about 0.0015 at 0.05). */
export const RECHECK_REPS: number = Number(process.env["ICHNAEA_RECHECK_REPS"] ?? 20_000);

/**
 * Screen columns. Counts are per level, in the order of LEVELS, as comma-separated lists:
 * `screen_hits` over `screen_reps` screening repetitions, and `hits` over `reps`, the
 * confirmation's when `stage` is "confirmed" and the screen's otherwise. `measure_hits` holds a
 * Holm point's per-measure rejections at 0.05, and is empty for every other point.
 */
export const SCREEN_COLUMNS = [
  "id",
  "generator",
  "family",
  "role",
  "k",
  "pattern",
  "test",
  "seed",
  "screen_hits",
  "screen_reps",
  "stage",
  "hits",
  "reps",
  "fails",
  "structure",
  "measure_hits",
] as const;
/**
 * Re-check columns, per level as comma-separated lists: the shipped test's and the study test's
 * rejections on the same repetitions, and the discordant counts (n10: only the shipped test
 * rejects; n01: only the study's). `exact` counts the repetitions where the shipped test took
 * the exact path.
 */
export const RECHECK_COLUMNS = [
  "id",
  "seed",
  "reps",
  "exact",
  "shipped_hits",
  "study_hits",
  "n10",
  "n01",
  "fails",
] as const;

/** Screening repetitions of a point: the screen's, or the point's own scaled with them. */
export const screenRepsOf = (point: Point): number =>
  point.reps === undefined ? SCREEN_REPS : Math.ceil((point.reps * SCREEN_REPS) / 6000);

/** Per-level rejection counts of a point over `reps` repetitions from `seed`, with the study's test. */
function rejectionCounts(
  point: Point,
  seed: number,
  reps: number,
): { hits: number[]; measures: number[] } {
  const rng = createRng(seed);
  const hits = LEVELS.map(() => 0);
  const measures: number[] = [];
  for (let i = 0; i < reps; i++) {
    const r = rejections(point, point.draw(rng), rng);
    r.levels.forEach((x, l) => {
      if (x) hits[l] = (hits[l] as number) + 1;
    });
    r.measures?.forEach((x, j) => {
      measures[j] = (measures[j] ?? 0) + (x ? 1 : 0);
    });
  }
  return { hits, measures };
}

/** Repetitions from the confirmation seed, in batches, until every level's standard error is at most CONFIRM_SE. */
function confirm(point: Point): { hits: number[]; reps: number } {
  const rng = createRng(point.confirmSeed);
  const hits = LEVELS.map(() => 0);
  let reps = 0;
  // About a quarter of the repetitions that reach CONFIRM_SE at 0.05, at most 50,000.
  const batch = Math.min(50_000, Math.ceil(minConfirmReps(CONFIRM_SE) / 4));
  do {
    for (let i = 0; i < batch; i++)
      rejections(point, point.draw(rng), rng).levels.forEach((x, l) => {
        if (x) hits[l] = (hits[l] as number) + 1;
      });
    reps += batch;
  } while (!confirmationDone(hits, reps, CONFIRM_SE));
  return { hits, reps };
}

function parseShard(text: string | undefined): { index: number; count: number } {
  const m = /^(\d+)\/(\d+)$/.exec(text ?? "");
  const index = Number(m?.[1]);
  const count = Number(m?.[2]);
  if (!m || !(count >= 1 && index >= 0 && index < count))
    throw new RangeError(`--shard must be i/n with 0 ≤ i < n, got ${text}`);
  return { index, count };
}

function argument(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
}

/** The runtime a sidecar records: the engine's name and version, the platform and the CPU architecture. */
export interface Runtime {
  readonly name: string;
  readonly version: string;
  readonly platform: string;
  readonly arch: string;
}

/**
 * The runtime that computes a shard. V8's Math is not bit-identical across platforms, so a study's
 * shards and their later phases must all run on one runtime, and its outputs compare byte for byte
 * only within it.
 */
export const runtime = (): Runtime => ({
  name: "node",
  version: process.version,
  platform: process.platform,
  arch: process.arch,
});

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

interface Screened {
  readonly point: Point;
  readonly reps: number;
  readonly hits: number[];
  readonly measures: number[];
}

function screen(args: readonly string[]): void {
  const { index, count } = parseShard(argument(args, "--shard"));
  const dir = argument(args, "--out") ?? "results";
  mkdirSync(dir, { recursive: true });
  const output = path.join(dir, `screen-${index}-of-${count}.tsv`);
  const meta = provenance(local("./study-score-type-i.ts"), 2_000_000, [...args]);
  const mine: Cell[] = shardOf(cells(), index, count);
  const seeds: number[] = [];
  // Refinement steps whose perturbation left [0.01, 0.99]: no row, recorded here, so the collector
  // can account for every step of every refined cell.
  const refinementSkips: Record<string, number[]> = {};
  const extra = (): Record<string, unknown> => ({
    phase: "screen",
    refinementSkips,
    shard: { index, count },
    cells: mine.length,
    reps: SCREEN_REPS,
    confirmSe: CONFIRM_SE,
    levels: LEVELS,
    studyResamples: STUDY_RESAMPLES,
    seedRange: seeds.length === 0 ? null : [Math.min(...seeds), Math.max(...seeds)],
    runtime: runtime(),
    runner: runner(),
  });
  writeFileSync(output, `${SCREEN_COLUMNS.join("\t")}\n`);
  writeMeta(output, meta, false, extra());
  for (const cell of mine) {
    const screenPoint = (point: Point): Screened => {
      const reps = screenRepsOf(point);
      return { point, reps, ...rejectionCounts(point, point.seed, reps) };
    };
    const screened = cell.points.map(screenPoint);
    if (cell.refine !== undefined) {
      // Hill-climbing from the worst structures: each chain tries 4 rounds of 5 perturbations and
      // moves to one that is worse. Step t of chain h is structure 500 + 20·h + t, whether or not
      // the perturbation stays in range, so a point's seeds never depend on another's result.
      const bad = (x: Screened): number => worstness(x.hits, x.reps);
      const starts = screened.toSorted((a, b) => bad(b) - bad(a)).slice(0, G2_REFINE_WORST);
      starts.forEach((start, chain) => {
        let current = start;
        for (let round = 0; round < G2_REFINE_ROUNDS; round++)
          for (let step = 0; step < G2_REFINE_STEPS_PER_ROUND; step++) {
            const s =
              G2_STRUCTURES + G2_REFINE_STEPS * chain + G2_REFINE_STEPS_PER_ROUND * round + step;
            const next = cell.refine?.(current.point, s);
            if (next === undefined) {
              (refinementSkips[cell.id] ??= []).push(s);
              continue;
            }
            const scored = screenPoint(next);
            screened.push(scored);
            if (bad(scored) > bad(current)) current = scored;
          }
      });
    }
    for (const { point, reps: screenReps, hits: screenHits, measures } of screened) {
      seeds.push(point.seed);
      let stage = "screen";
      let hits = screenHits;
      let reps = screenReps;
      // A point with its own repetitions (the Holm simulation) is reported from them alone.
      if (point.reps === undefined && needsConfirmation(screenHits, screenReps)) {
        const c = confirm(point);
        seeds.push(point.confirmSeed);
        stage = "confirmed";
        hits = c.hits;
        reps = c.reps;
      }
      appendFileSync(
        output,
        `${[
          point.id,
          point.generator,
          point.family,
          point.role,
          point.shape.k,
          point.shape.pattern,
          point.test,
          point.seed,
          formatCounts(screenHits),
          screenReps,
          stage,
          formatCounts(hits),
          reps,
          (stage === "confirmed" || point.reps !== undefined) && failsAtAnyLevel(hits, reps),
          (point.params["structure"] as string | undefined) ?? "",
          measures.length === 0 ? "" : measures.join(","),
        ].join("\t")}\n`,
      );
    }
    console.log(`${cell.id}: ${screened.length} point(s)`);
  }
  writeMeta(output, meta, true, extra());
}

const zeros = (): number[] => LEVELS.map(() => 0);
const add = (xs: number[], l: number): void => {
  xs[l] = (xs[l] as number) + 1;
};

/**
 * The re-check of a point from its re-check seed: each repetition draws one data set and runs the
 * shipped test and then the study's test on it, from the same stream.
 */
function paired(
  point: Point,
  reps: number,
): { shipped: number[]; study: number[]; n10: number[]; n01: number[]; exact: number } {
  const rng = createRng(point.recheckSeed);
  const out = { shipped: zeros(), study: zeros(), n10: zeros(), n01: zeros(), exact: 0 };
  for (let i = 0; i < reps; i++) {
    const data = point.draw(rng);
    const shipped = shippedTest(data, rng);
    if (shipped.method === "within-case-permutation-exact") out.exact++;
    const study = runTest(point, data, rng);
    LEVELS.forEach((level, l) => {
      const a = shipped.p <= level;
      const b = studyRejects(study, level);
      if (a) add(out.shipped, l);
      if (b) add(out.study, l);
      if (a && !b) add(out.n10, l);
      if (b && !a) add(out.n01, l);
    });
  }
  return out;
}

function recheck(args: readonly string[]): void {
  const { index, count } = parseShard(argument(args, "--shard"));
  const dir = argument(args, "--out") ?? "results";
  const list = argument(args, "--points");
  if (list === undefined) throw new RangeError("--points is required");
  mkdirSync(dir, { recursive: true });
  const output = path.join(dir, `recheck-${index}-of-${count}.tsv`);
  const meta = provenance(local("./study-score-type-i.ts"), 4_000_000, [...args]);
  const listText = readFileSync(list, "utf8");
  const selected = shardOfList(listText, index, count);
  // The collector checks that every shard ran the list it rebuilds from the screen outputs.
  const pointsSha256 = createHash("sha256").update(listText).digest("hex");
  const byCell = new Map(cells().map((cell) => [cell.id, cell]));
  const seeds: number[] = [];
  const extra = (): Record<string, unknown> => ({
    phase: "recheck",
    shard: { index, count },
    points: selected.length,
    pointsSha256,
    reps: RECHECK_REPS,
    levels: LEVELS,
    studyResamples: STUDY_RESAMPLES,
    seedRange: seeds.length === 0 ? null : [Math.min(...seeds), Math.max(...seeds)],
    runtime: runtime(),
    runner: runner(),
  });
  writeFileSync(output, `${RECHECK_COLUMNS.join("\t")}\n`);
  writeMeta(output, meta, false, extra());
  for (const s of selected) {
    const { row, seed } = recheckRow(byCell, s, RECHECK_REPS);
    seeds.push(seed);
    appendFileSync(output, `${row}\n`);
    console.log(row);
  }
  writeMeta(output, meta, true, extra());
}

/** One entry of the re-check list: a point's ID, and its stored structure for a refinement step. */
export interface RecheckEntry {
  readonly id: string;
  readonly structure?: string;
}

/** The entries of the re-check list that shard \`index\` of \`count\` runs. */
export const shardOfList = (listText: string, index: number, count: number): RecheckEntry[] =>
  (JSON.parse(listText) as { points: RecheckEntry[] }).points.filter(
    (_p, i) => i % count === index,
  );

/**
 * The re-check of one entry at \`reps\` repetitions, as its output row (RECHECK_COLUMNS, tab
 * separated) and its seed. The point is the grid's, or a refinement step rebuilt and checked from
 * its stored structure; a stored structure must be the point's exactly.
 */
export function recheckRow(
  byCell: ReadonlyMap<string, Cell>,
  entry: RecheckEntry,
  reps: number,
): { row: string; seed: number } {
  const point = pointById(byCell, entry.id, entry.structure);
  if (!point.recheck) throw new Error(`${point.id} does not run the permutation test`);
  if (entry.structure !== undefined && point.params["structure"] !== entry.structure)
    throw new Error(`${point.id}: the listed structure is not the point's`);
  const r = paired(point, reps);
  const row = [
    point.id,
    point.recheckSeed,
    reps,
    r.exact,
    formatCounts(r.shipped),
    formatCounts(r.study),
    formatCounts(r.n10),
    formatCounts(r.n01),
    failsAtAnyLevel(r.shipped, reps),
  ].join("\t");
  return { row, seed: point.recheckSeed };
}

if (import.meta.main) {
  const [phase, ...args] = process.argv.slice(2);
  if (phase === "screen") screen(args);
  else if (phase === "recheck") recheck(args);
  else throw new RangeError(`the phase must be "screen" or "recheck", got ${phase}`);
}
