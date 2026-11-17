// The study of the judge calibration rule (VALIDATION.md, "The judge calibration rule"): every cell
// of CELLS, STUDIES studies each, RESAMPLES case resamples per study, one seeded stream per cell.
//   node --import ./scripts/stats/record-loads.ts scripts/stats/study-calibration-rule.ts \
//     shard --shard i/n --out <dir>
//     runs the cells i, i + n, i + 2n, … and writes <dir>/shard-i.tsv with its sidecar;
//   node --import ./scripts/stats/record-loads.ts scripts/stats/study-calibration-rule.ts \
//     merge --in <dir> [--pull <N>] validation/calibration-rule.tsv
//     joins the shards in cell order and writes the output with its provenance sidecar. The
//     sidecar pins the modules that the merge and every shard loaded; every shard must have run
//     at the merge's commit. A published output names its pull request with --pull.
// A cell's rows depend only on its seed, never on the shard that ran it.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { createRng } from "../../src/stats/rng.ts";
import { CONDITIONS, calibrationRule } from "./calibration-rule.ts";
import {
  CELLS,
  MARGINS,
  SLOPE_LEVELS,
  runCell,
  type CellResult,
} from "./calibration-rule-study.ts";
import {
  metaPath,
  mergeShards,
  provenance,
  type Provenance,
  sha256,
  writeMeta,
} from "./provenance.ts";

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

function parseShard(text: string | undefined): [number, number] {
  const match = /^(\d+)\/(\d+)$/.exec(text ?? "");
  const shard = Number(match?.[1]);
  const shards = Number(match?.[2]);
  if (!match || shards < 1 || shard >= shards)
    throw new RangeError(`--shard must be i/n with i < n, got '${text}'`);
  return [shard, shards];
}

/** The provenance that a shard's sidecar records; throws when its output has other bytes. */
function shardProvenance(tsv: string): Provenance {
  const meta = JSON.parse(readFileSync(metaPath(tsv), "utf8")) as Provenance & {
    readonly complete?: boolean;
    readonly outputSha256?: string;
  };
  if (meta.complete !== true || meta.outputSha256 !== sha256(readFileSync(tsv)))
    throw new Error(`${tsv} is not the complete output that its sidecar records`);
  return meta;
}

if (import.meta.main) {
  const [phase, ...rest] = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      shard: { type: "string" },
      out: { type: "string" },
      in: { type: "string" },
      pull: { type: "string" },
    },
  });
  if (phase === "shard") {
    const [shard, shards] = parseShard(values.shard);
    const out = values.out ?? "calibration-rule-shards";
    const meta = provenance(import.meta.filename, SEED_BASE, process.argv.slice(2));
    mkdirSync(out, { recursive: true });
    const tsv = path.join(out, `shard-${shard}.tsv`);
    writeFileSync(tsv, `${runShard(shard, shards, STUDIES, RESAMPLES).join("\n")}\n`);
    writeMeta(tsv, meta, true);
  } else if (phase === "merge") {
    const output = positionals[0];
    const dir = values.in;
    if (!output || !dir) throw new RangeError("merge needs --in <dir> and an output path");
    const files = readdirSync(dir).filter((f) => /^shard-\d+\.tsv$/.test(f));
    const meta = mergeShards(
      provenance(import.meta.filename, SEED_BASE, process.argv.slice(2), {
        pull: values.pull === undefined ? undefined : Number(values.pull),
      }),
      files.map((f) => shardProvenance(path.join(dir, f))),
    );
    const rows = files.flatMap((f) =>
      readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean),
    );
    const order = new Map(CELLS.map((cell, i) => [cell.id, i]));
    const sorted = rows.toSorted(
      (a, b) => order.get(a.split("\t")[0]!)! - order.get(b.split("\t")[0]!)!,
    );
    if (sorted.length !== CELLS.length)
      throw new Error(`expected ${CELLS.length} cells, got ${sorted.length}`);
    writeFileSync(output, `${COLUMNS.join("\t")}\n${sorted.join("\n")}\n`);
    writeMeta(output, meta, true, { studies: STUDIES, resamples: RESAMPLES, cells: CELLS.length });
  } else {
    throw new RangeError(`the phase must be "shard" or "merge", got ${phase}`);
  }
}
