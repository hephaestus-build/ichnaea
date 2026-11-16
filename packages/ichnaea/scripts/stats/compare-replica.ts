// Compares an exact phase of the sweep on GitHub Actions with the same phase run on another host,
// after both are downloaded: phases A and B are replicas, so every number must agree. Fails on any
// difference.
//   - The TSV rows of every margin, byte for byte, and the header. The other host's TSVs may be
//     whole worker files or grep output, in any order of files; its header lines are skipped.
//   - The skip logs, entry by entry: the same set of ids, and for each id the same canonical line
//     (RFC 8785: members sorted, numbers as ECMAScript prints them), and the same order within each
//     margin, because the runner seeds a structure by its index. Missing, extra and differing ids
//     are listed.
//   - The counts, taken from the other host's files: skip-log lines, their split by sweep phase,
//     the TSVs' own skip rows, and how many entries are unique by id and by structure (margin
//     and groups).
//   - With every margin, each worker file of the other host rebuilt from the per-margin outputs,
//     byte for byte (sha256).
// Usage: node scripts/compare-replica.ts --phase A|B --actions <artifacts> \
//          --server-tsv <file>... --server-skips <file>... [--margins i,j] [--out replica.json]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { sha256 } from "./provenance.ts";
import { exactFiles, marginsOf, marginText, MARGINS, SERVER_WORKERS } from "./sweep-job.ts";

/** The RFC 8785 form of a JSON value of plain members, strings and finite numbers. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.keys(value)
      .toSorted()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

const lines = (text: string): string[] => text.split("\n").filter((l) => l !== "");
const isHeader = (row: string): boolean => row.startsWith("margin\t");
/** The margins of a TSV's rows or a skip log's entries, in the order they first appear. */
const marginOrder = (fileLines: readonly string[]): string[] => [
  ...new Set(
    fileLines
      .filter((l) => !isHeader(l))
      .map((l) => (l.startsWith("{") ? skipEntry(l).margin : l.slice(0, l.indexOf("\t")))),
  ),
];

/** Rows grouped by their first column, in the order they appear. */
export function rowsByMargin(rows: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const m = r.slice(0, r.indexOf("\t"));
    out.set(m, [...(out.get(m) ?? []), r]);
  }
  return out;
}

export interface SkipEntry {
  readonly id: string;
  readonly margin: string;
  readonly phase: string;
  readonly canonical: string;
  readonly structure: string;
}

export const skipEntry = (line: string): SkipEntry => {
  const v = JSON.parse(line) as { id: string; margin: number; phase: string; groups: unknown };
  return {
    id: v.id,
    margin: v.margin.toFixed(3),
    phase: v.phase,
    canonical: canonical(v),
    structure: canonical({ margin: v.margin, groups: v.groups }),
  };
};

export interface SkipCounts {
  readonly lines: number;
  readonly split: Readonly<Record<string, number>>;
  readonly uniqueIds: number;
  readonly uniqueStructures: number;
}

/** Counts of a set of skip entries. */
export function skipCounts(entries: readonly SkipEntry[]): SkipCounts {
  const split: Record<string, number> = {};
  for (const e of entries) split[e.phase] = (split[e.phase] ?? 0) + 1;
  return {
    lines: entries.length,
    split,
    uniqueIds: new Set(entries.map((e) => e.id)).size,
    uniqueStructures: new Set(entries.map((e) => e.structure)).size,
  };
}

export interface SkipDiff {
  readonly missing: string[];
  readonly extra: string[];
  readonly differing: string[];
  readonly reordered: string[];
}

const sameSet = (x: readonly string[] = [], y: readonly string[] = []): boolean =>
  JSON.stringify(x.toSorted()) === JSON.stringify(y.toSorted());
const read = (f: string): string => readFileSync(f, "utf8");
const skipRowSum = (rows: readonly string[]): number =>
  rows.filter((r) => r.split("\t")[1] === "skip").reduce((a, r) => a + Number(r.split("\t")[2]), 0);

/** Missing, extra and differing ids, and margins whose order of ids differs. */
export function compareSkips(
  server: readonly SkipEntry[],
  actions: readonly SkipEntry[],
): SkipDiff {
  const s = new Map(server.map((e) => [e.id, e]));
  const a = new Map(actions.map((e) => [e.id, e]));
  const missing = [...s.keys()].filter((id) => !a.has(id));
  const extra = [...a.keys()].filter((id) => !s.has(id));
  const differing = [...s.keys()].filter(
    (id) => a.has(id) && a.get(id)?.canonical !== s.get(id)?.canonical,
  );
  const order = (es: readonly SkipEntry[]) => rowsByMargin(es.map((e) => `${e.margin}\t${e.id}`));
  const so = order(server);
  const ao = order(actions);
  // Margins with the same ids in another order: their structures would get other seeds.
  const reordered = [...so.keys()].filter(
    (m) => JSON.stringify(so.get(m)) !== JSON.stringify(ao.get(m)) && sameSet(so.get(m), ao.get(m)),
  );
  return { missing, extra, differing, reordered };
}

const firstOf = (xs: readonly string[]): Listed => ({ count: xs.length, first: xs.slice(0, 20) });

type Listed = { readonly count: number; readonly first: readonly string[] };
export interface ReplicaReport {
  readonly phase: "A" | "B";
  readonly margins: string[];
  readonly identical: boolean;
  readonly problems: string[];
  readonly counts: {
    readonly server: SkipCounts & { readonly tsvSkipRows: number };
    readonly actions: SkipCounts & { readonly tsvSkipRows: number };
  };
  readonly rows: {
    readonly differing: ReadonlyArray<{
      margin: string;
      server: number;
      actions: number;
      firstDifferent: number;
    }>;
  };
  readonly skips: {
    readonly missing: Listed;
    readonly extra: Listed;
    readonly differing: Listed;
    readonly reordered: readonly string[];
  };
  readonly rebuilt: ReadonlyArray<{ file: string; identical: boolean }>;
}

export function compareReplica(
  phase: "A" | "B",
  actionsRoot: string,
  serverTsv: readonly string[],
  serverSkips: readonly string[],
  margins: readonly number[],
): ReplicaReport {
  const wanted = new Set(margins.map(marginText));
  const problems: string[] = [];

  // TSV rows, margin by margin.
  const serverAll = serverTsv.flatMap((f) => lines(read(f)));
  const serverHeaders = new Set(serverAll.filter(isHeader));
  const serverRows = rowsByMargin(serverAll.filter((r) => !isHeader(r)));
  for (const m of serverRows.keys())
    if (!wanted.has(m) && margins.length === MARGINS)
      problems.push(`the server has rows of margin ${m}`);
  const actionsRows = new Map<string, string[]>();
  const actionsSkips: SkipEntry[] = [];
  const actionsSkipText = new Map<string, string>();
  const actionsTsvText = new Map<string, string>();
  let actionsHeader: string | undefined;
  for (const i of margins) {
    const { tsv, skips } = exactFiles(actionsRoot, phase, i);
    const [header = "", ...rows] = lines(read(tsv));
    actionsHeader ??= header;
    if (header !== actionsHeader) problems.push(`${path.basename(tsv)}: another header`);
    actionsRows.set(marginText(i), rows);
    actionsTsvText.set(marginText(i), rows.map((r) => `${r}\n`).join(""));
    const text = read(skips);
    actionsSkipText.set(marginText(i), text);
    actionsSkips.push(...lines(text).map(skipEntry));
  }
  if (
    serverHeaders.size > 0 &&
    (serverHeaders.size !== 1 || !serverHeaders.has(actionsHeader ?? ""))
  )
    problems.push("the TSV headers differ");
  const rowDiffs: Array<{
    margin: string;
    server: number;
    actions: number;
    firstDifferent: number;
  }> = [];
  for (const m of wanted) {
    const s = serverRows.get(m) ?? [];
    const a = actionsRows.get(m) ?? [];
    const at = s.findIndex((r, j) => r !== a[j]);
    if (s.length !== a.length || at !== -1)
      rowDiffs.push({
        margin: m,
        server: s.length,
        actions: a.length,
        firstDifferent: at === -1 ? Math.min(s.length, a.length) : at,
      });
  }
  if (rowDiffs.length > 0) problems.push(`TSV rows differ at ${rowDiffs.length} margins`);
  const serverSkipRows = [...serverRows].filter(([m]) => wanted.has(m)).flatMap(([, rs]) => rs);

  // Skip logs, entry by entry.
  const serverSkipEntries = serverSkips
    .flatMap((f) => lines(read(f)).map(skipEntry))
    .filter((e) => wanted.has(e.margin));
  const diff = compareSkips(serverSkipEntries, actionsSkips);
  const server = { ...skipCounts(serverSkipEntries), tsvSkipRows: skipRowSum(serverSkipRows) };
  const actions = {
    ...skipCounts(actionsSkips),
    tsvSkipRows: skipRowSum([...actionsRows.values()].flat()),
  };
  if (server.uniqueIds !== server.lines) problems.push("the server's skip log repeats an id");
  if (server.tsvSkipRows !== server.lines)
    problems.push("the server's skip rows do not sum to its skip-log lines");
  if (canonical(server) !== canonical(actions)) problems.push("the skip-log counts differ");
  for (const [k, xs] of Object.entries(diff))
    if (xs.length > 0) problems.push(`${xs.length} ${k} skip-log entries`);

  // With every margin: the server's worker files, rebuilt from the per-margin outputs.
  const rebuilt: Array<{ file: string; identical: boolean }> = [];
  if (margins.length === MARGINS) {
    for (const [files, text, header] of [
      [serverTsv, actionsTsvText, `${actionsHeader}\n`],
      [serverSkips, actionsSkipText, ""],
    ] as const)
      for (const f of files) {
        const bytes =
          header +
          marginOrder(lines(read(f)))
            .map((m) => text.get(m) ?? "")
            .join("");
        const identical = sha256(bytes) === sha256(readFileSync(f));
        rebuilt.push({ file: path.basename(f), identical });
        if (!identical) problems.push(`${path.basename(f)} is not the rebuilt per-margin outputs`);
      }
    if (serverTsv.length !== SERVER_WORKERS)
      problems.push(`expected ${SERVER_WORKERS} server TSVs`);
  }

  return {
    phase,
    margins: [...wanted],
    identical: problems.length === 0,
    problems,
    counts: { server, actions },
    rows: { differing: rowDiffs },
    skips: {
      missing: firstOf(diff.missing),
      extra: firstOf(diff.extra),
      differing: firstOf(diff.differing),
      reordered: diff.reordered,
    },
    rebuilt,
  };
}

function main(): void {
  const { values } = parseArgs({
    options: {
      phase: { type: "string" },
      actions: { type: "string" },
      "server-tsv": { type: "string", multiple: true },
      "server-skips": { type: "string", multiple: true },
      margins: { type: "string" },
      out: { type: "string" },
    },
  });
  const phase = values.phase;
  if ((phase !== "A" && phase !== "B") || values.actions === undefined)
    throw new Error(
      "usage: compare-replica.ts --phase A|B --actions <dir> --server-tsv <f>... --server-skips <f>...",
    );
  const report = compareReplica(
    phase,
    values.actions,
    values["server-tsv"] ?? [],
    values["server-skips"] ?? [],
    marginsOf(values.margins),
  );
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (values.out === undefined) process.stdout.write(text);
  else writeFileSync(values.out, text);
  for (const p of report.problems) console.error(p);
  console.error(report.identical ? `phase ${phase}: identical` : `phase ${phase}: DIFFERS`);
  if (!report.identical) process.exit(1);
}

if (import.meta.main) main();
