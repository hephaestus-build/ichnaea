// Embeds the worst structures of an exact sweep in larger suites, for scripts/simulate-structures.ts.
//
// 1. Reads the sweep's TSVs (scripts/study-heterogeneous.ts, each with its sidecar, which must pass
//    scripts/check-sweep-provenance.ts) and takes the --top structures (default 20) with the lowest
//    exact coverage over all margins at k = 11 to 17, from the per-cell rows ("k<cell>"). Ties go
//    to the smaller margin, then the smaller k, then the cell, the file and the line.
// 2. Rebuilds each structure from its row: k, r, the noisy cases' rates and trials, the stable
//    base and candidate rates, the stable cases at 3 trials and the one-trial cells. The margin is
//    the sweep's own value, from + i·step, from the sidecar's arguments. The TSV prints rates to 4
//    decimals, so the last noisy case's candidate rate is solved again by the sweep's `groupsOf`;
//    the sidecar counts the structures whose printed rates were off -margin. The exact coverage
//    of the rebuilt groups must lie within 5e-5 of the TSV's value. A row that cannot be rebuilt,
//    or a coverage that differs, stops the script: no structure is guessed.
// 3. For each structure and each K of --sizes (default 20, 30 and 60), writes two structures with
//    K − k padding cases that pass every trial in both arms (base and candidate rate 1). Padding
//    cases run the cell's trial count: 2 under r = 2 or mixed counts, 3 under r = 3.
//    - "dilute": the padding only. The truth becomes -margin·k/K. The record's `margin` is -truth,
//      because the runner checks coverage at truth -margin; `sourceMargin` keeps the sweep's.
//    - "keep-truth": the stable drop grows by margin·(K − k)/(stable cases), so the stable cases
//      carry the padding's share of the difference, and the last noisy case is solved again by
//      `groupsOf`; the mean difference is -margin at K. When the stable candidate rate would fall
//      below 0, or the last noisy case's rate outside [0, 1], the structure cannot keep its truth
//      at that K: it gets no record, and the sidecar lists and counts it.
//    Each record carries its source (file, line, rank, k, margin, coverage, seed), its mode, K and
//    its truth.
// Usage:
//   node scripts/embed-worst.ts <sweep-0.tsv>... --out <embedded.jsonl> [--top 20] [--sizes 20,30,60]
// The output must not exist; its sidecar records the provenance (scripts/provenance.ts).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { exactGroupCoverage, type Group, truthOfGroups } from "../test/support/exact.ts";
import { checkProvenance } from "./check-sweep-provenance.ts";
import { metaPath, provenance, repoRoot, sha256, writeMeta } from "./provenance.ts";
import { groupsOf, type OneTrial, type Structure } from "./study-heterogeneous.ts";

/** Largest difference between the TSV's coverage and the rebuilt structure's exact coverage. */
export const COVERAGE_TOLERANCE = 5e-5;

/** The sweep's header, without and with the one_trial column. */
const HEADER =
  "margin\trank\tcoverage\tevaluated\tskipped\tk\tr\tnoisy\tstable_base\tstable_candidate\tstable_at_three\tnoisy_rates@trials";

/** One per-cell row of a sweep TSV. */
export interface Row {
  readonly file: string;
  readonly line: number;
  readonly margin: string;
  readonly rank: string;
  readonly coverage: number;
  readonly fields: readonly string[];
}

/** The per-cell rows of a sweep TSV. Throws when the header is not the sweep's. */
export function perCellRows(file: string, text: string): { rows: Row[]; oneTrial: boolean } {
  const lines = text.split("\n");
  const header = lines[0];
  if (header !== HEADER && header !== `${HEADER}\tone_trial`)
    throw new Error(`${file} is not a sweep TSV`);
  const rows: Row[] = [];
  lines.forEach((l, i) => {
    const f = l.split("\t");
    if (i === 0 || l === "" || !f[1]?.startsWith("k")) return;
    rows.push({
      file,
      line: i + 1,
      margin: f[0] as string,
      rank: f[1],
      coverage: Number(f[2]),
      fields: f,
    });
  });
  return { rows, oneTrial: header !== HEADER };
}

const NOISY = /^(\d\.\d{4})->(\d\.\d{4})@([123])(?:\/([123]))?$/;
const ONE_TRIAL = /^c(\d+)b(\d+)(?:n(candidate|base))?$/;

/** Why a row cannot be rebuilt. */
export class RebuildError extends Error {
  override readonly name = "RebuildError";
}

/**
 * The structure of a per-cell row, at the sweep's margin. Throws a RebuildError when the row does
 * not describe a structure of the sweep exactly.
 */
export function structureOf(row: Row, margin: number, oneTrialColumn: boolean): Structure {
  const where = `${row.file}:${row.line}`;
  const f = row.fields;
  const [, , , , , kText, rText, noisyText, baseText, candText, atThreeText, ratesText] = f;
  if (f.length !== (oneTrialColumn ? 13 : 12))
    throw new RebuildError(`${where}: ${f.length} columns`);
  const k = Number(kText);
  const r = rText === "2/3" ? "2/3" : rText === "2" ? 2 : rText === "3" ? 3 : undefined;
  if (!Number.isInteger(k) || r === undefined)
    throw new RebuildError(`${where}: k or r unreadable`);
  const stableBase = Number(baseText);
  const stableCandidate = Number(candText);
  const stableAtThree = Number(atThreeText);
  const entries = (ratesText ?? "").split(",").map((e) => NOISY.exec(e));
  if (entries.some((e) => e === null) || entries.length !== Number(noisyText))
    throw new RebuildError(`${where}: noisy rates unreadable`);
  let oneTrial: OneTrial | undefined;
  const o = f[12];
  if (oneTrialColumn && o !== "-") {
    const m = ONE_TRIAL.exec(o ?? "");
    if (!m) throw new RebuildError(`${where}: one_trial ${o} unreadable`);
    oneTrial = {
      candidate: Number(m[1]),
      base: Number(m[2]),
      ...(m[3] ? { lastNoisy: m[3] as "candidate" | "base" } : {}),
    };
  }
  const noisy: Array<readonly [number, number]> = [];
  const noisyTrials: number[] = [];
  entries.forEach((e, i) => {
    const [, b, c, bt, ct] = e as RegExpExecArray;
    const baseTrials = Number(bt);
    const candidateTrials = ct === undefined ? baseTrials : Number(ct);
    const last = i === entries.length - 1;
    const lastNoisy = last ? oneTrial?.lastNoisy : undefined;
    // Only the last noisy case can have a one-trial cell, and only where the column says so.
    const trials =
      lastNoisy === "base" && baseTrials === 1
        ? candidateTrials
        : lastNoisy === "candidate" && candidateTrials === 1
          ? baseTrials
          : lastNoisy === undefined && baseTrials === candidateTrials
            ? baseTrials
            : undefined;
    if (trials === undefined || trials === 1)
      throw new RebuildError(`${where}: noisy case ${i + 1} has trials ${bt}/${ct ?? bt}`);
    if (!last) noisy.push([Number(b), Number(c)]);
    noisyTrials.push(trials);
  });
  const s: Structure = {
    k,
    r,
    stableAtThree: r === "2/3" ? stableAtThree : 0,
    stableBase,
    drop: stableBase - stableCandidate,
    noisy,
    noisyTrials,
    lastBase: Number((entries.at(-1) as RegExpExecArray)[1]),
    ...(oneTrial ? { oneTrial } : {}),
  };
  if (`k${k}|${r}${oneTrial ? "+1t" : ""}` !== row.rank)
    throw new RebuildError(`${where}: the row's cell ${row.rank} does not match its structure`);
  return s;
}

/** A rebuilt structure: its groups at the sweep's margin, and whether the last rate was solved again. */
export interface Rebuilt {
  readonly s: Structure;
  readonly margin: number;
  readonly groups: Group[];
  readonly coverage: number;
  /** True when the printed rates gave a truth off -margin, so the last candidate rate was re-solved. */
  readonly resolved: boolean;
}

/** Rebuilds a row's groups and checks their exact coverage against the row. */
export function rebuild(row: Row, margin: number, oneTrialColumn: boolean): Rebuilt {
  const s = structureOf(row, margin, oneTrialColumn);
  const groups = groupsOf(s, margin, Number.POSITIVE_INFINITY);
  if (!groups)
    throw new RebuildError(
      `${row.file}:${row.line}: the printed rates give no structure at ${margin}`,
    );
  const printedLast = Number(
    ((row.fields[11] ?? "").split(",").at(-1) ?? "").split("->")[1]?.slice(0, 6),
  );
  const n = s.noisy.length;
  const printed = groups.map((g, i) => (i === n ? { ...g, candidate: printedLast } : g));
  const resolved = Math.abs(truthOfGroups(printed) + margin) > 1e-12;
  const coverage = exactGroupCoverage(groups);
  if (Math.abs(coverage - row.coverage) > COVERAGE_TOLERANCE)
    throw new RebuildError(
      `${row.file}:${row.line}: rebuilt coverage ${coverage.toFixed(6)} differs from the TSV's ${row.coverage}`,
    );
  return { s, margin, groups, coverage, resolved };
}

/**
 * The structures that cannot keep their truth, counted per size and margin (`K60|0.300`), as the
 * summary reports them beside the simulated ones.
 */
export function countByKAndMargin(
  skipped: ReadonlyArray<{ readonly K: number; readonly margin: number }>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { K, margin } of skipped) {
    const key = `K${K}|${margin.toFixed(3)}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** The trials of a padding case: the cell's count, and 2 under mixed counts. */
export const padTrials = (r: 2 | 3 | "2/3"): number => (r === 3 ? 3 : 2);

const padding = (count: number, r: 2 | 3 | "2/3"): Group => ({
  count,
  base: 1,
  candidate: 1,
  baseTrials: padTrials(r),
  candidateTrials: padTrials(r),
});

export type Mode = "dilute" | "keep-truth";

/** An embedded structure, as the runner reads it, or why keep-truth has none. */
export type Embedded =
  | { readonly ok: true; readonly groups: Group[]; readonly truth: number }
  | { readonly ok: false; readonly reason: string };

/** Embeds a rebuilt structure of k cases in K cases. */
export function embed(b: Rebuilt, K: number, mode: Mode): Embedded {
  const { s, margin } = b;
  if (K <= s.k) throw new RangeError(`K = ${K} must exceed k = ${s.k}`);
  if (mode === "dilute") {
    const groups = [...b.groups, padding(K - s.k, s.r)];
    return { ok: true, groups, truth: truthOfGroups(groups) };
  }
  const stable = s.k - s.noisy.length - 1;
  const drop = s.drop + (margin * (K - s.k)) / stable;
  if (s.stableBase - drop < 0)
    return {
      ok: false,
      reason: `the stable candidate rate ${(s.stableBase - drop).toFixed(4)} is below 0`,
    };
  // groupsOf solves the last noisy case for a total difference of -margin·k; asking for
  // margin·K/k over the k cases gives -margin·K, which the padding leaves as it is.
  const groups = groupsOf({ ...s, drop }, (margin * K) / s.k, Number.POSITIVE_INFINITY);
  if (!groups)
    return { ok: false, reason: "the last noisy case's candidate rate is outside [0, 1]" };
  const all = [...groups, padding(K - s.k, s.r)];
  return { ok: true, groups: all, truth: truthOfGroups(all) };
}

/** The sweep's margins as it computed them: from + i·step, from a sidecar's arguments. */
export function marginsOf(args: readonly string[]): (printed: string) => number {
  const { positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      out: { type: "string" },
      "seed-base": { type: "string" },
      "skip-log": { type: "string" },
      "one-trial": { type: "boolean" },
      count: { type: "boolean" },
      sample: { type: "string" },
    },
  });
  const from = Number(positionals[0] ?? "0.06");
  const step = Number(positionals[2] ?? "0.005");
  return (printed) => {
    const margin = from + Math.round((Number(printed) - from) / step) * step;
    if (margin.toFixed(3) !== printed)
      throw new RebuildError(`margin ${printed} is not on the sweep's grid`);
    return margin;
  };
}

/** The --top rows, lowest coverage first; ties by margin, k, cell, file and line. */
export function worstRows(rows: readonly Row[], top: number): Row[] {
  const k = (r: Row): number => Number(r.fields[5]);
  return rows
    .filter((r) => k(r) >= 11 && k(r) <= 17)
    .toSorted(
      (a, b) =>
        a.coverage - b.coverage ||
        Number(a.margin) - Number(b.margin) ||
        k(a) - k(b) ||
        a.rank.localeCompare(b.rank) ||
        a.file.localeCompare(b.file) ||
        a.line - b.line,
    )
    .slice(0, top);
}

function main(): void {
  const args = process.argv.slice(2);
  const { values, positionals: inputs } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      out: { type: "string" },
      top: { type: "string", default: "20" },
      sizes: { type: "string", default: "20,30,60" },
    },
  });
  const { out } = values;
  if (out === undefined || inputs.length === 0)
    throw new Error("usage: embed-worst.ts <sweep.tsv>... --out <embedded.jsonl>");
  if (existsSync(out)) throw new Error(`${out} exists already; give a new file`);
  const here = import.meta.dirname;
  const failures = checkProvenance(inputs, repoRoot(import.meta.filename));
  if (failures.length > 0) throw new Error(`the inputs' provenance fails:\n${failures.join("\n")}`);
  const p = provenance(
    import.meta.filename,
    [
      path.join(here, "study-heterogeneous.ts"),
      path.join(here, "check-sweep-provenance.ts"),
      path.join(here, "provenance.ts"),
      path.join(here, "../test/support/exact.ts"),
    ],
    null,
    args,
  );
  const sizes = values.sizes.split(",").map(Number);
  const rows: Array<
    Row & { oneTrial: boolean; marginOf: (m: string) => number; seedBase: number }
  > = [];
  for (const input of inputs) {
    const meta = JSON.parse(readFileSync(metaPath(input), "utf8")) as Record<string, unknown>;
    if (meta["kind"] !== "sweep" || meta["complete"] !== true)
      throw new Error(`${input} is not a complete sweep output`);
    const parsed = perCellRows(path.basename(input), readFileSync(input, "utf8"));
    if (parsed.oneTrial !== meta["oneTrial"])
      throw new Error(`${input}: the one_trial column does not match its sidecar`);
    const marginOf = marginsOf(meta["arguments"] as string[]);
    for (const r of parsed.rows)
      rows.push({
        ...r,
        oneTrial: parsed.oneTrial,
        marginOf,
        seedBase: meta["seedBase"] as number,
      });
  }
  const worst = worstRows(rows, Number(values.top)) as typeof rows;
  const lines: string[] = [];
  const impossible: unknown[] = [];
  const sources: unknown[] = [];
  let resolved = 0;
  worst.forEach((row, i) => {
    const margin = row.marginOf(row.margin);
    const b = rebuild(row, margin, row.oneTrial);
    if (b.resolved) resolved++;
    const rank = String(i + 1).padStart(2, "0");
    const source = {
      file: row.file,
      line: row.line,
      rank: row.rank,
      worst: i + 1,
      k: b.s.k,
      r: b.s.r,
      margin,
      coverage: row.coverage,
      rebuiltCoverage: b.coverage,
      seed: row.seedBase + Math.round(margin * 10_000),
    };
    sources.push(source);
    for (const K of sizes)
      for (const mode of ["dilute", "keep-truth"] as const) {
        const e = embed(b, K, mode);
        if (!e.ok) {
          impossible.push({ worst: i + 1, K, margin, mode, reason: e.reason });
          continue;
        }
        lines.push(
          JSON.stringify({
            id: `w${rank}-K${K}-${mode}`,
            margin: -e.truth,
            k: K,
            r: b.s.r,
            cell: `${K}|${b.s.r}${b.s.oneTrial ? "+1t" : ""}:${mode}`,
            mode,
            K,
            truth: e.truth,
            sourceMargin: margin,
            source,
            groups: e.groups,
          }),
        );
      }
  });
  writeFileSync(out, lines.map((l) => `${l}\n`).join(""));
  const impossibleByKAndMargin = countByKAndMargin(
    impossible as Array<{ K: number; margin: number }>,
  );
  writeMeta(out, p, true, {
    kind: "embedded",
    inputs: inputs.map((f) => ({ path: path.basename(f), sha256: sha256(readFileSync(f)) })),
    top: Number(values.top),
    sizes,
    padTrials: "2 under r = 2 or mixed counts, 3 under r = 3; base and candidate rate 1",
    structures: lines.length,
    resolved,
    keepTruthImpossible: impossible.length,
    impossibleByKAndMargin,
    impossible,
    sources,
  });
  console.error(
    `${lines.length} structures from ${worst.length} sources in ${out}; ${resolved} re-solved, ${impossible.length} cannot keep their truth`,
  );
}

if (import.meta.main) main();
