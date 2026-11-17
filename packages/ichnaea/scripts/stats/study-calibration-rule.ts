// The study of the judge calibration rule (VALIDATION.md, "The judge calibration rule"): every cell
// of CELLS, STUDIES studies each, RESAMPLES case resamples per study, one seeded stream per cell.
//   node scripts/stats/study-calibration-rule.ts shard --shard i/n --out <dir>
//     runs the cells i, i + n, i + 2n, … and writes <dir>/shard-i.tsv with its provenance sidecar;
//   node scripts/stats/study-calibration-rule.ts merge --in <dir> validation/calibration-rule.tsv
//     joins the shards in cell order and writes the output with its provenance sidecar. It refuses
//     a shard whose sidecar names another commit, other source files or another Node version, and
//     a set of shards without exactly one row per cell.
// A cell's rows depend only on its seed, never on the shard that ran it.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { createRng } from "../../src/stats/index.ts";
import { CONDITIONS, calibrationRule } from "./calibration-rule.ts";
import {
  CELLS,
  MARGINS,
  SLOPE_LEVELS,
  runCell,
  type CellResult,
} from "./calibration-rule-study.ts";
import { type Provenance, provenance, sha256, writeMeta } from "./provenance.ts";

export const STUDIES = 2000;
export const RESAMPLES = 2000;
export const SEED_BASE = 6_000_000;
/** The seed of cell i: SEED_BASE + i. */
export const seedOf = (index: number): number => SEED_BASE + index;

export const COLUMNS = [
  "cell",
  "studies",
  "resamples",
  "pass",
  "passSe",
  ...CONDITIONS.map((name) => `${name}Holds`),
  "meanArmBias",
  "meanShownBound",
  ...MARGINS.map((m) => `withinMargin${m.toFixed(2)}`),
  "nanShare",
  "meanPositives",
  "meanPositiveItems",
  "meanEffectivePositives",
  "meanSlope",
  "meanSlopeLower",
  ...SLOPE_LEVELS.map((s) => `slopeLowerAtLeast${s.toFixed(1)}`),
  "dropShown",
  "meanHumanDrop",
  "passable",
] as const;

const format = (x: number): string => (Number.isNaN(x) ? "NA" : x.toPrecision(6));

export function row(result: CellResult, resamples: number): string {
  return [
    result.cell,
    result.studies,
    resamples,
    format(result.pass),
    format(result.passSe),
    ...result.conditions.map(format),
    format(result.meanArmBias),
    format(result.meanShownBound),
    ...result.withinMargin.map(format),
    format(result.nanShare),
    format(result.meanPositives),
    format(result.meanPositiveItems),
    format(result.meanEffectivePositives),
    format(result.meanSlope),
    format(result.meanSlopeLower),
    ...result.slopeLowerAtLeast.map(format),
    format(result.dropShown),
    format(result.meanHumanDrop),
    format(result.passable),
  ].join("\t");
}

/** Runs the cells of one shard. */
export function runShard(
  shard: number,
  shards: number,
  studies: number,
  resamples: number,
): string[] {
  const rule = calibrationRule({ agreementTolerance: 0.15, rateTolerance: 0.1, resamples });
  return CELLS.flatMap((cell, index) =>
    index % shards === shard
      ? [row(runCell(cell, rule, createRng(seedOf(index)), studies), resamples)]
      : [],
  );
}

/** The rows in cell order. Throws unless every cell has exactly one row and no row is unknown. */
export function orderRows(rows: readonly string[]): string[] {
  const order = new Map(CELLS.map((cell, i) => [cell.id, i]));
  const seen = new Map<string, number>();
  for (const r of rows) {
    const id = r.split("\t")[0]!;
    if (!order.has(id)) throw new Error(`a shard has a row for an unknown cell '${id}'`);
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  const wrong = CELLS.filter((cell) => seen.get(cell.id) !== 1).map(
    (cell) => `${cell.id} (${seen.get(cell.id) ?? 0} rows)`,
  );
  if (wrong.length > 0)
    throw new Error(`every cell needs exactly one row; these do not: ${wrong.join(", ")}`);
  return rows.toSorted((a, b) => order.get(a.split("\t")[0]!)! - order.get(b.split("\t")[0]!)!);
}

/**
 * Reads the shards in `dir` and checks each against the merge's provenance: its sidecar must exist,
 * be complete, match the shard's bytes, and name the same commit, files and Node version. Each
 * shard is read once, and its rows come from the bytes that were checked. Returns the rows and the
 * shards' start times.
 */
export function readShards(
  dir: string,
  merge: Provenance,
): { readonly rows: string[]; readonly starts: string[] } {
  const shards = readdirSync(dir)
    .filter((f) => /^shard-\d+\.tsv$/.test(f))
    .map((f) => readShard(path.join(dir, f), merge));
  return { rows: shards.flatMap((s) => s.rows), starts: shards.map((s) => s.started) };
}

function readShard(file: string, merge: Provenance): { rows: string[]; started: string } {
  const bytes = readFileSync(file);
  const metaFile = `${file}.meta.json`;
  if (!existsSync(metaFile)) throw new Error(`${file} has no provenance sidecar; rerun the shard`);
  const shard = JSON.parse(readFileSync(metaFile, "utf8")) as Partial<Provenance> & {
    complete?: boolean;
    outputSha256?: string;
  };
  const mismatch =
    shard.complete !== true
      ? "it is incomplete"
      : shard.outputSha256 !== sha256(bytes)
        ? "its rows do not match its sidecar"
        : shard.commit !== merge.commit
          ? `it ran at ${shard.commit}, the merge runs at ${merge.commit}`
          : JSON.stringify(shard.files) !== JSON.stringify(merge.files)
            ? "it ran other source files"
            : shard.node !== merge.node
              ? `it ran on Node ${shard.node}, the merge on ${merge.node}`
              : undefined;
  if (mismatch !== undefined) throw new Error(`${file}: ${mismatch}; rerun the shard`);
  return { rows: bytes.toString("utf8").split("\n").filter(Boolean), started: shard.started! };
}

function parseShard(text: string | undefined): [number, number] {
  const match = /^(\d+)\/(\d+)$/.exec(text ?? "");
  const shard = Number(match?.[1]);
  const shards = Number(match?.[2]);
  if (!match || shards < 1 || shard >= shards)
    throw new RangeError(`--shard must be i/n with i < n, got '${text}'`);
  return [shard, shards];
}

if (import.meta.main) {
  const [phase, ...rest] = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { shard: { type: "string" }, out: { type: "string" }, in: { type: "string" } },
  });
  if (phase === "shard") {
    const [shard, shards] = parseShard(values.shard);
    const out = values.out ?? "calibration-rule-shards";
    // Each shard records its own provenance, so the merge can refuse shards from other code.
    const meta = provenance(
      new URL(import.meta.url).pathname,
      [],
      SEED_BASE,
      process.argv.slice(2),
    );
    mkdirSync(out, { recursive: true });
    const file = path.join(out, `shard-${shard}.tsv`);
    writeFileSync(file, `${runShard(shard, shards, STUDIES, RESAMPLES).join("\n")}\n`);
    writeMeta(file, meta, true, { studies: STUDIES, resamples: RESAMPLES });
  } else if (phase === "merge") {
    const output = positionals[0];
    const dir = values.in;
    if (!output || !dir) throw new RangeError("merge needs --in <dir> and an output path");
    const meta = provenance(
      new URL(import.meta.url).pathname,
      [],
      SEED_BASE,
      process.argv.slice(2),
    );
    const { rows, starts } = readShards(dir, meta);
    const sorted = orderRows(rows);
    writeFileSync(output, `${COLUMNS.join("\t")}\n${sorted.join("\n")}\n`);
    writeMeta(output, { ...meta, started: starts.toSorted()[0] ?? meta.started }, true, {
      studies: STUDIES,
      resamples: RESAMPLES,
      cells: CELLS.length,
    });
  } else {
    throw new RangeError(`the phase must be "shard" or "merge", got ${phase}`);
  }
}
