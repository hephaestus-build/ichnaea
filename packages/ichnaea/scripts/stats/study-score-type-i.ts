// The type-I study of the score permutation test (VALIDATION.md, "Score measures: the regression
// test"), one shard at a time. Two phases, each sharded:
//
//   node scripts/study-score-type-i.ts screen --shard 3/80 --out results/
//     Screens every point of the shard's cells at ICHNAEA_SIM_REPS repetitions (6,000), refines
//     each G2 cell around its worst structures, and confirms every candidate with its confirmation
//     seed until the standard error is at most 0.0005. Writes screen-3-of-80.tsv.
//
//   node scripts/study-score-type-i.ts recheck --points results/recheck.json --shard 3/20 --out results/
//     Re-checks the points that the collector selected with the shipped test (exact, or 10,000
//     resamples with the rerun near the level) at 20,000 repetitions. Writes recheck-3-of-20.tsv.
//
// Each output has a sidecar `<output>.meta.json` (scripts/provenance.ts) with the commit, the
// script hashes, the arguments, the Node version, the runner image, the phase, the shard and the
// seed range. `scripts/collect-score-type-i.ts` checks completeness and digests and applies the rule.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createRng } from "../../src/stats/index.ts";
import { provenance, writeMeta } from "./provenance.ts";
import {
  ALPHA,
  type Cell,
  cells,
  G2_REFINE_WORST,
  G2_STRUCTURES,
  type Point,
  pointById,
  runTest,
  shardOf,
  shippedTest,
} from "./score-type-i-points.ts";

/** Screening repetitions: 6,000 in the study; a smaller value is a smoke run, and the collector refuses it. */
export const SCREEN_REPS: number = Number(process.env["ICHNAEA_SIM_REPS"] ?? 6000);
/** A confirmation runs until its standard error is at most this: 0.0005 in the study. */
export const CONFIRM_SE: number = Number(process.env["ICHNAEA_CONFIRM_SE"] ?? 0.0005);
/** Repetitions of the re-check with the shipped test (SE about 0.0015 at 0.05). */
export const RECHECK_REPS: number = Number(process.env["ICHNAEA_RECHECK_REPS"] ?? 20_000);

const se = (p: number, n: number): number => Math.sqrt((p * (1 - p)) / n);
const clears = (p: number, s: number): boolean => p <= ALPHA - 2 * s;
const fails = (p: number, s: number): boolean => p - 3 * s > ALPHA;

export const SCREEN_COLUMNS = [
  "id",
  "generator",
  "family",
  "role",
  "k",
  "pattern",
  "test",
  "seed",
  "screen_rate",
  "stage",
  "value",
  "se",
  "reps",
  "fails",
  "structure",
] as const;
export const RECHECK_COLUMNS = [
  "id",
  "seed",
  "study_value",
  "study_se",
  "value",
  "se",
  "reps",
  "fails",
] as const;

/** The rejection rate of a point over `reps` repetitions from `seed`, with the study's test or the shipped one. */
function rate(point: Point, seed: number, reps: number, shipped: boolean): number {
  const rng = createRng(seed);
  let hits = 0;
  for (let i = 0; i < reps; i++) {
    const data = point.draw(rng);
    if ((shipped ? shippedTest(data, rng) : runTest(point, data, rng)) <= ALPHA) hits++;
  }
  return hits / reps;
}

/** Repetitions from the confirmation seed, in batches, until the standard error is at most CONFIRM_SE. */
function confirm(point: Point): { value: number; reps: number } {
  const rng = createRng(point.confirmSeed);
  let hits = 0;
  let reps = 0;
  // About a quarter of the repetitions that reach CONFIRM_SE at 0.05, at most 50,000.
  const batch = Math.min(50_000, Math.ceil((0.05 * 0.95) / CONFIRM_SE ** 2 / 4));
  do {
    for (let i = 0; i < batch; i++) {
      const data = point.draw(rng);
      if (runTest(point, data, rng) <= ALPHA) hits++;
    }
    reps += batch;
    // At least the repetitions that reach CONFIRM_SE at 0.05 (about 190,000 at 0.0005): an estimate
    // of 0 or 1 has a standard error of 0, which would otherwise stop the loop after one batch.
  } while (reps < (0.05 * 0.95) / CONFIRM_SE ** 2 || se(hits / reps, reps) > CONFIRM_SE);
  return { value: hits / reps, reps };
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

const local = (file: string): string => new URL(file, import.meta.url).pathname;
const SCRIPTS = [
  local("./score-type-i-points.ts"),
  local("./provenance.ts"),
  local("../../src/stats/score-permutation.ts"),
  local("../../src/stats/score-permutation-core.ts"),
  local("../../src/stats/exact-conditional.ts"),
  local("../../src/stats/normal.ts"),
  local("../../src/stats/mt19937.ts"),
  local("../../src/stats/rng.ts"),
];

function screen(args: readonly string[]): void {
  const { index, count } = parseShard(argument(args, "--shard"));
  const dir = argument(args, "--out") ?? "results";
  mkdirSync(dir, { recursive: true });
  const output = path.join(dir, `screen-${index}-of-${count}.tsv`);
  const meta = provenance(local("./study-score-type-i.ts"), SCRIPTS, 2_000_000, [...args]);
  const mine: Cell[] = shardOf(cells(), index, count);
  const seeds: number[] = [];
  const extra = (): Record<string, unknown> => ({
    phase: "screen",
    shard: { index, count },
    cells: mine.length,
    reps: SCREEN_REPS,
    confirmSe: CONFIRM_SE,
    seedRange: seeds.length === 0 ? null : [Math.min(...seeds), Math.max(...seeds)],
    runner: runner(),
  });
  writeFileSync(output, `${SCREEN_COLUMNS.join("\t")}\n`);
  writeMeta(output, meta, false, extra());
  for (const cell of mine) {
    const screened = cell.points.map((point) => ({
      point,
      value: rate(point, point.seed, SCREEN_REPS, false),
    }));
    if (cell.refine) {
      const worst = screened.toSorted((a, b) => b.value - a.value).slice(0, G2_REFINE_WORST);
      for (const point of cell.refine(
        worst.map((w) => w.point),
        G2_STRUCTURES,
      ))
        screened.push({ point, value: rate(point, point.seed, SCREEN_REPS, false) });
    }
    for (const { point, value } of screened) {
      const s = se(value, SCREEN_REPS);
      seeds.push(point.seed);
      let stage = "screen";
      let final = value;
      let reps = SCREEN_REPS;
      if (!clears(value, s)) {
        const c = confirm(point);
        seeds.push(point.confirmSeed);
        stage = "confirmed";
        final = c.value;
        reps = c.reps;
      }
      const finalSe = se(final, reps);
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
          value,
          stage,
          final,
          finalSe,
          reps,
          stage === "confirmed" && fails(final, finalSe),
          (point.params["structure"] as string | undefined) ?? "",
        ].join("\t")}\n`,
      );
    }
    console.log(`${cell.id}: ${screened.length} point(s)`);
  }
  writeMeta(output, meta, true, extra());
}

function recheck(args: readonly string[]): void {
  const { index, count } = parseShard(argument(args, "--shard"));
  const dir = argument(args, "--out") ?? "results";
  const list = argument(args, "--points");
  if (list === undefined) throw new RangeError("--points is required");
  mkdirSync(dir, { recursive: true });
  const output = path.join(dir, `recheck-${index}-of-${count}.tsv`);
  const meta = provenance(local("./study-score-type-i.ts"), SCRIPTS, 4_000_000, [...args]);
  const selected = (
    JSON.parse(readFileSync(list, "utf8")) as {
      points: { id: string; structure?: string; value: number; se: number }[];
    }
  ).points.filter((_point, i) => i % count === index);
  const byCell = new Map(cells().map((cell) => [cell.id, cell]));
  const seeds: number[] = [];
  const extra = (): Record<string, unknown> => ({
    phase: "recheck",
    shard: { index, count },
    points: selected.length,
    reps: RECHECK_REPS,
    seedRange: seeds.length === 0 ? null : [Math.min(...seeds), Math.max(...seeds)],
    runner: runner(),
  });
  writeFileSync(output, `${RECHECK_COLUMNS.join("\t")}\n`);
  writeMeta(output, meta, false, extra());
  for (const s of selected) {
    const point = pointById(byCell, s.id, s.structure);
    if (!point.recheck) throw new Error(`${point.id} does not run the permutation test`);
    seeds.push(point.recheckSeed);
    const value = rate(point, point.recheckSeed, RECHECK_REPS, true);
    const valueSe = se(value, RECHECK_REPS);
    appendFileSync(
      output,
      `${[point.id, point.recheckSeed, s.value, s.se, value, valueSe, RECHECK_REPS, fails(value, valueSe)].join("\t")}\n`,
    );
    console.log(`${point.id}: study ${s.value.toFixed(4)}, shipped ${value.toFixed(4)}`);
  }
  writeMeta(output, meta, true, extra());
}

if (import.meta.main) {
  const [phase, ...args] = process.argv.slice(2);
  if (phase === "screen") screen(args);
  else if (phase === "recheck") recheck(args);
  else throw new RangeError(`the phase must be "screen" or "recheck", got ${phase}`);
}
