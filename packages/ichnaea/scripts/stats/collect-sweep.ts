// The collector of the confirmation sweep on GitHub Actions: reads the artifacts of every job of a
// run (scripts/sweep-job.ts), checks that they are complete and that their provenance holds, and
// writes summary.json. Fails, after writing the summary, when anything is missing or mismatched.
//
// Checks:
//   - every job names the same commit, which is HEAD here, and the same Node version; every
//     output has the sha256 that its job.json records;
//   - every margin of every selected exact phase, with the arguments of the confirmation run, a
//     complete sidecar, rows of its own margin only, and skip rows that sum to its skip log's lines;
//   - every shard of every simulation set, with the inputs that the exact phases or the generator
//     wrote, and together exactly the structures of those inputs, each once;
//   - the large suites' sha256 is GENERATOR_SHA256;
//   - scripts/check-sweep-provenance.ts passes on every output.
// summary.json holds, per phase, the worst exact coverage per k, r and margin, and per simulation
// set the worst estimate per cell and margin with its median and 5th percentile (descriptions
// only); the evaluated, skipped, simulated and impossible counts (the embedding's per K and
// margin); the skip logs' split by sweep phase; the sha256 of every artifact file; the commit and
// the runner images. Its bytes depend only on the artifacts, so a rerun on the downloaded
// artifacts gives the same file.
// Usage: node scripts/collect-sweep.ts --in <artifacts> --out <dir> --phases A,B,C,D,E-large,E-embedded
//   [--margins i,j] [--jobs n]   (the dry run's subset, as given to scripts/sweep-job.ts)
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { checkProvenance } from "./check-sweep-provenance.ts";
import { git, metaPath, repoRoot, sha256 } from "./provenance.ts";
import { HEADER as SIM_HEADER, readStructures } from "./simulate-structures.ts";
import {
  EXACT,
  embeddedFile,
  exactArgs,
  exactFiles,
  GENERATOR_SHA256,
  JOB_SCHEMA,
  marginsOf,
  marginText,
  parsePhases,
  type Phase,
  PROCESSES,
  range,
  setsOf,
  SIMULATIONS,
  type SimulationSet,
  simulationFile,
  simulationInputs,
  structuresFile,
  workersOf,
} from "./sweep-job.ts";

export const SUMMARY_SCHEMA = "ichnaea.sweep-summary/1";

const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
const lines = (file: string): string[] =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l !== "");
const numeric = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });

/** Every file under `root`, relative to it, sorted. */
function walk(root: string, dir = ""): string[] {
  return readdirSync(path.join(root, dir))
    .toSorted()
    .flatMap((f) => {
      const rel = path.join(dir, f);
      return statSync(path.join(root, rel)).isDirectory() ? walk(root, rel) : [rel];
    });
}

/** The q-quantile of sorted values, by the nearest rank. */
export const quantile = (sorted: readonly number[], q: number): number =>
  sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] as number;

export type SkipPhase = "grid" | "random" | "refine";

/** One margin of an exact phase, read and checked. */
export interface ExactMargin {
  readonly margin: string;
  readonly evaluated: number;
  readonly skipped: number;
  readonly skipSplit: Record<SkipPhase, number>;
  /** The per-cell rows: the worst coverage of each k, r (and one-trial family) at this margin. */
  readonly worst: ReadonlyArray<{ cell: string; coverage: number; row: string }>;
}

/** Reads one exact margin's TSV and skip log; pushes every problem found. */
export function readExactMargin(
  tsv: string,
  skipLog: string,
  margin: string,
  problems: string[],
): ExactMargin | undefined {
  const name = path.basename(tsv);
  const [header, ...rows] = lines(tsv);
  if (!header?.startsWith("margin\trank\tcoverage\t")) {
    problems.push(`${name}: no sweep header`);
    return undefined;
  }
  const counts = new Set<string>();
  let skipRows = 0;
  const worst: Array<{ cell: string; coverage: number; row: string }> = [];
  for (const row of rows) {
    const f = row.split("\t");
    if (f[0] !== margin) problems.push(`${name}: a row of margin ${f[0]}`);
    counts.add(`${f[3]}\t${f[4]}`);
    if (f[1] === "skip") skipRows += Number(f[2]);
    else if (f[1]?.startsWith("k"))
      worst.push({ cell: f[1].slice(1), coverage: Number(f[2]), row });
  }
  if (counts.size !== 1)
    problems.push(`${name}: its rows disagree on the evaluated and skipped counts`);
  const [evaluated = NaN, skipped = NaN] = ([...counts][0] ?? "").split("\t").map(Number);
  const skipSplit: Record<SkipPhase, number> = { grid: 0, random: 0, refine: 0 };
  const ids = new Set<string>();
  const entries = lines(skipLog);
  for (const line of entries) {
    const e = JSON.parse(line) as { id: string; margin: number; phase: SkipPhase };
    if (ids.has(e.id)) problems.push(`${path.basename(skipLog)}: id ${e.id} twice`);
    ids.add(e.id);
    if (e.margin.toFixed(3) !== margin)
      problems.push(`${path.basename(skipLog)}: ${e.id} has margin ${e.margin}`);
    if (!(e.phase in skipSplit))
      problems.push(`${path.basename(skipLog)}: ${e.id} has phase ${e.phase}`);
    else skipSplit[e.phase]++;
  }
  if (skipRows !== skipped || entries.length !== skipped)
    problems.push(
      `${name}: ${skipped} skipped, skip rows sum to ${skipRows}, the log has ${entries.length}`,
    );
  worst.sort((a, b) => numeric(a.cell, b.cell));
  return { margin, evaluated, skipped, skipSplit, worst };
}

/** One row of a simulation TSV. */
export interface SimRow {
  readonly id: string;
  readonly margin: string;
  readonly k: number;
  readonly cell: string;
  readonly stage: string;
  readonly estimate: number;
  readonly se: number;
  readonly result: string;
  readonly seed: number;
}

export const parseSimRow = (row: string): SimRow => {
  const [id = "", margin = "", k, , cell = "", stage = "", estimate, se, , result = "", seed] =
    row.split("\t");
  return {
    id,
    margin,
    k: Number(k),
    cell,
    stage,
    estimate: Number(estimate),
    se: Number(se),
    result,
    seed: Number(seed),
  };
};

export interface SimulationCell {
  readonly cell: string;
  readonly margin: string;
  readonly structures: number;
  readonly fails: number;
  readonly confirmed: number;
  readonly worst: Pick<SimRow, "id" | "estimate" | "se" | "stage" | "result" | "seed">;
  readonly p5: number;
  readonly median: number;
}

/** Per cell and margin: structures, fails, confirmed, the worst, the 5th percentile and the median. */
export function simulationCells(rows: readonly SimRow[]): SimulationCell[] {
  const groups = new Map<string, SimRow[]>();
  for (const r of rows) {
    const key = `${r.cell}\t${r.margin}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups]
    .toSorted(([a], [b]) => numeric(a, b))
    .map(([key, rs]) => {
      const [cell = "", margin = ""] = key.split("\t");
      const sorted = rs.map((r) => r.estimate).toSorted((a, b) => a - b);
      const w = rs.reduce((a, b) =>
        b.estimate < a.estimate || (b.estimate === a.estimate && b.id < a.id) ? b : a,
      );
      return {
        cell,
        margin,
        structures: rs.length,
        fails: rs.filter((r) => r.result === "fail").length,
        confirmed: rs.filter((r) => r.stage !== "screen").length,
        worst: {
          id: w.id,
          estimate: w.estimate,
          se: w.se,
          stage: w.stage,
          result: w.result,
          seed: w.seed,
        },
        p5: quantile(sorted, 0.05),
        median: quantile(sorted, 0.5),
      };
    });
}

/**
 * The embedded structures per K and source margin, by mode: how many were simulated and how many
 * failed. The id names the source margin (`m<margin>-w<rank>-K<K>-<mode>`, scripts/embed-worst.ts);
 * a diluted row's own margin is its diluted truth.
 */
export function embeddedCounts(
  rows: readonly SimRow[],
): Array<{ K: number; margin: string } & Record<string, number | string>> {
  const counts = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const m = /^m(\d\.\d{3})-w\d+-K(\d+)-(dilute|keep-truth)$/.exec(r.id);
    if (!m) throw new Error(`${r.id} is not an embedded structure`);
    const [, margin = "", K = "", mode = ""] = m;
    const key = `${K}\t${margin}`;
    const entry = counts.get(key) ?? {};
    entry[mode] = (entry[mode] ?? 0) + 1;
    if (r.result === "fail") entry[`${mode}Fails`] = (entry[`${mode}Fails`] ?? 0) + 1;
    counts.set(key, entry);
  }
  return [...counts]
    .toSorted(([a], [b]) => numeric(a, b))
    .map(([key, modes]) => {
      const [K = "", margin = ""] = key.split("\t");
      return { K: Number(K), margin, ...modes };
    });
}

function collect(
  root: string,
  phases: readonly Phase[],
  margins: readonly number[],
  jobsOverride?: number,
) {
  const problems: string[] = [];
  const repo = repoRoot(import.meta.filename);
  const head = git(["rev-parse", "HEAD"], repo);
  const outputs: string[] = [];
  const need = (file: string): boolean => {
    if (existsSync(file)) return true;
    problems.push(`missing ${path.relative(root, file)}`);
    return false;
  };
  const complete = (file: string): Record<string, unknown> | undefined => {
    if (!need(file) || !need(metaPath(file))) return undefined;
    outputs.push(file);
    const meta = readJson(metaPath(file));
    if (meta["complete"] !== true)
      problems.push(`${path.relative(root, file)}: its sidecar is not complete`);
    return meta;
  };

  // The jobs: one commit, HEAD here, one Node version, and outputs as each job recorded them.
  const jobFiles = walk(root).filter((f) => path.basename(f) === "job.json");
  const runners = new Map<string, number>();
  const commits = new Set<string>();
  const nodes = new Set<string>();
  for (const f of jobFiles) {
    const job = readJson(path.join(root, f));
    if (job["schema"] !== JOB_SCHEMA) problems.push(`${f}: not a sweep job record`);
    commits.add(String(job["commit"]));
    nodes.add(String(job["node"]));
    const r = job["runner"] as { imageOS: string | null; imageVersion: string | null };
    const image = `${r.imageOS ?? "unknown"} ${r.imageVersion ?? "unknown"}`;
    runners.set(image, (runners.get(image) ?? 0) + 1);
    for (const o of job["outputs"] as Array<{ file: string; sha256: string }>) {
      const file = path.join(root, path.dirname(f), o.file);
      if (!existsSync(file) || sha256(readFileSync(file)) !== o.sha256)
        problems.push(`${path.dirname(f)}/${o.file}: not the bytes its job recorded`);
    }
  }
  if (commits.size !== 1 || !commits.has(head))
    problems.push(
      `the jobs ran from ${[...commits].join(", ") || "no commit"}, the collector from ${head}`,
    );
  if (nodes.size !== 1) problems.push(`the jobs ran on Node ${[...nodes].join(", ")}`);

  // The exact phases.
  const exact: Record<string, unknown> = {};
  for (const p of (["A", "B", "C"] as const).filter((x) => phases.includes(x))) {
    const read: ExactMargin[] = [];
    for (const i of margins) {
      const { tsv, skips } = exactFiles(root, p, i);
      const meta = complete(tsv);
      const skipMeta = complete(skips);
      if (!meta || !skipMeta) continue;
      const args = exactArgs(p, i, path.basename(tsv), path.basename(skips));
      const given = (meta["arguments"] as string[]).map((a) =>
        a.includes("/") ? path.basename(a) : a,
      );
      if (JSON.stringify(given) !== JSON.stringify(args))
        problems.push(`${path.basename(tsv)}: ran with ${given.join(" ")}`);
      if (meta["seedBase"] !== EXACT[p].seedBase)
        problems.push(`${path.basename(tsv)}: seed base ${String(meta["seedBase"])}`);
      const m = readExactMargin(tsv, skips, marginText(i), problems);
      if (m) read.push(m);
    }
    const split = { grid: 0, random: 0, refine: 0 };
    for (const m of read)
      for (const k of ["grid", "random", "refine"] as const) split[k] += m.skipSplit[k];
    const all = read.flatMap((m) => m.worst.map((w) => ({ margin: m.margin, ...w })));
    exact[p] = {
      seedBase: EXACT[p].seedBase,
      cases: EXACT[p].cases,
      margins: read.length,
      evaluated: read.reduce((a, m) => a + m.evaluated, 0),
      skipped: read.reduce((a, m) => a + m.skipped, 0),
      skipSplit: split,
      lowest: all.reduce<(typeof all)[number] | undefined>(
        (a, b) => (a === undefined || b.coverage < a.coverage ? b : a),
        undefined,
      ),
      perMargin: read.map((m) => ({
        margin: m.margin,
        evaluated: m.evaluated,
        skipped: m.skipped,
        skipSplit: m.skipSplit,
      })),
      worst: all.map(({ margin, cell, coverage, row }) => {
        const [k, r] = cell.split("|");
        return { margin, k: Number(k), r, cell, coverage, row };
      }),
    };
  }

  // The large suites.
  if (phases.includes("E-large") && need(structuresFile(root))) {
    complete(structuresFile(root));
    const digest = sha256(readFileSync(structuresFile(root)));
    if (digest !== GENERATOR_SHA256)
      problems.push(`structures.jsonl has sha256 ${digest}, not ${GENERATOR_SHA256}`);
  }
  // The embedding: its inputs are phase B's TSVs.
  let embedding: Record<string, unknown> | undefined;
  if (phases.includes("E-embedded")) {
    const meta = complete(embeddedFile(root));
    if (meta) {
      const want = margins.map((i) => {
        const f = exactFiles(root, "B", i).tsv;
        return { path: path.basename(f), sha256: existsSync(f) ? sha256(readFileSync(f)) : null };
      });
      if (JSON.stringify(meta["inputs"]) !== JSON.stringify(want))
        problems.push("embedded.jsonl: its inputs are not phase B's TSVs of this run");
      embedding = {
        structures: meta["structures"],
        resolved: meta["resolved"],
        keepTruthImpossible: meta["keepTruthImpossible"],
        impossibleByKAndMargin: meta["impossibleByKAndMargin"],
      };
    }
  }

  // The simulation sets.
  const simulations: Record<string, unknown> = {};
  const rowsBySet = new Map<SimulationSet, SimRow[]>();
  for (const set of setsOf(phases)) {
    const spec = SIMULATIONS[set];
    const jobs = jobsOverride ?? spec.jobs;
    const workers = PROCESSES * jobs;
    const inputs = simulationInputs(root, set, margins);
    if (!inputs.every((f) => existsSync(f))) {
      problems.push(`${set}: inputs missing, its shards are not checked`);
      continue;
    }
    const wantInputs = inputs.map((f) => ({
      path: path.basename(f),
      sha256: sha256(readFileSync(f)),
    }));
    const minK = spec.minK ?? 1;
    const expected = new Map(
      readStructures(inputs)
        .filter(({ s }) => s.k >= minK)
        .map(({ index, s }) => [s.id, index]),
    );
    const rows: SimRow[] = [];
    const seen = new Set<string>();
    for (const job of range(jobs))
      for (const worker of workersOf(job)) {
        const file = simulationFile(root, set, job, worker);
        const meta = complete(file);
        if (!meta) continue;
        const name = path.relative(root, file);
        const shard = { seedBase: spec.seedBase, worker, workers, minK };
        if (JSON.stringify(meta["shard"]) !== JSON.stringify(shard))
          problems.push(`${name}: shard ${JSON.stringify(meta["shard"])}`);
        if (JSON.stringify(meta["inputs"]) !== JSON.stringify(wantInputs))
          problems.push(`${name}: not this run's inputs`);
        const [header, ...body] = lines(file);
        if (header !== SIM_HEADER) problems.push(`${name}: no runner header`);
        for (const line of body) {
          const r = parseSimRow(line);
          const index = expected.get(r.id);
          if (index === undefined || index % workers !== worker)
            problems.push(`${name}: ${r.id} is not in this shard`);
          if (seen.has(r.id)) problems.push(`${name}: ${r.id} judged twice`);
          seen.add(r.id);
          rows.push(r);
        }
      }
    const missing = [...expected.keys()].filter((id) => !seen.has(id));
    if (missing.length > 0)
      problems.push(`${set}: ${missing.length} structures not judged, first ${missing[0]}`);
    rowsBySet.set(set, rows);
    simulations[set] = {
      seedBase: spec.seedBase,
      minK,
      shards: workers,
      structures: expected.size,
      simulated: rows.length,
      fails: rows.filter((r) => r.result === "fail").length,
      confirmed: rows.filter((r) => r.stage !== "screen").length,
      cells: simulationCells(rows),
    };
  }
  const embeddedRows = rowsBySet.get("E-embedded");
  if (embedding && embeddedRows) embedding["simulatedByKAndMargin"] = embeddedCounts(embeddedRows);

  problems.push(...checkProvenance(outputs, repo, { published: false }));
  const files = Object.fromEntries(
    walk(root).map((f) => [f, sha256(readFileSync(path.join(root, f)))]),
  );
  const summary = {
    schema: SUMMARY_SCHEMA,
    commit: head,
    node: [...nodes].toSorted(),
    runnerImages: Object.fromEntries([...runners].toSorted(([a], [b]) => a.localeCompare(b))),
    phases,
    margins: margins.map(marginText),
    jobs: jobFiles.length,
    complete: problems.length === 0,
    problems,
    exact,
    ...(embedding ? { embedding } : {}),
    simulations,
    files,
  };
  return summary;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      in: { type: "string" },
      out: { type: "string" },
      phases: { type: "string" },
      margins: { type: "string" },
      jobs: { type: "string" },
    },
  });
  if (values.in === undefined || values.out === undefined || values.phases === undefined)
    throw new Error("usage: collect-sweep.ts --in <artifacts> --out <dir> --phases <list>");
  const summary = collect(
    values.in,
    parsePhases(values.phases),
    marginsOf(values.margins),
    values.jobs === undefined ? undefined : Number(values.jobs),
  );
  mkdirSync(values.out, { recursive: true });
  writeFileSync(path.join(values.out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  for (const p of summary.problems) console.error(p);
  console.log(
    `${summary.jobs} jobs, ${Object.keys(summary.files).length} files; ${summary.problems.length} problems; summary.json written`,
  );
  if (!summary.complete) process.exit(1);
}

if (import.meta.main) main();
