// Collects the sharded outputs of scripts/study-score-type-i.ts, checks that they are complete and
// unaltered, and applies the rule.
//
//   node scripts/collect-score-type-i.ts select --in results/
//     Checks every screen shard, then writes results/recheck.json: the points the shipped test
//     re-checks (every confirmed or failing point that runs the permutation test, and the 10 worst
//     of each generator).
//
//   node scripts/collect-score-type-i.ts verdict --in results/
//     Checks the screen and re-check shards, applies the rule, and writes results/summary.json and
//     results/summary.md.
//
// A check fails, and the command exits non-zero, when a shard is missing or duplicated, a sidecar is
// incomplete, an output's sha256 differs from its sidecar, the shards ran different commits or
// scripts, a script differs from the checked-out one, a point is missing or duplicated, or a run used
// fewer repetitions than the study's (unless --smoke, for a trial of the pipeline).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { metaPath, repoRoot } from "./provenance.ts";
import {
  ALPHA,
  cells,
  G2_REFINE_STEPS,
  G2_REFINE_WORST,
  G2_STRUCTURES,
  R1_CASE_COUNTS,
} from "./score-type-i-points.ts";
import { RECHECK_COLUMNS, type Runtime, SCREEN_COLUMNS } from "./study-score-type-i.ts";

/** Worst points of each generator that the shipped test re-checks, candidates or not. */
export const WORST_PER_GENERATOR = 10;

export type Row = Record<string, string>;
interface Meta {
  readonly commit: string;
  readonly files: Record<string, string>;
  readonly complete: boolean;
  readonly outputSha256?: string;
  readonly phase: string;
  readonly reps: number;
  readonly confirmSe?: number;
  readonly shard: { index: number; count: number };
  readonly runtime?: Runtime;
}

/** A runtime as one comparable string: the engine and its version, the platform and the CPU architecture. */
const runtimeKey = (r: Meta["runtime"]): string =>
  r === undefined ? "unrecorded" : `${r.name} ${r.version} ${r.platform} ${r.arch}`;

const sha256 = (file: string): string =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

export function readTsv(file: string, columns: readonly string[]): Row[] {
  // Rows end in a newline. Never trim: a row whose last column is empty ends in a tab.
  const [header, ...lines] = readFileSync(file, "utf8").split("\n").slice(0, -1);
  if (header !== columns.join("\t")) throw new Error(`${file}: unexpected header`);
  return lines.map((line) => {
    const values = line.split("\t");
    if (values.length !== columns.length)
      throw new Error(`${file}: a row has ${values.length} values`);
    return Object.fromEntries(columns.map((c, i) => [c, values[i] as string]));
  });
}

/** Reads every shard of a phase and checks it. Returns the rows and the commit they ran. */
export function readPhase(
  dir: string,
  phase: "screen" | "recheck",
  columns: readonly string[],
  reps: number,
  smoke: boolean,
  problems: string[],
): { rows: Row[]; commit: string | undefined; runtime: string | undefined } {
  const pattern = new RegExp(`^${phase}-(\\d+)-of-(\\d+)\\.tsv$`);
  const files = readdirSync(dir)
    .map((f) => ({ f, m: pattern.exec(f) }))
    .filter((x) => x.m !== null);
  if (files.length === 0) {
    problems.push(`no ${phase} output in ${dir}`);
    return { rows: [], commit: undefined, runtime: undefined };
  }
  const counts = new Set(files.map((x) => Number(x.m?.[2])));
  if (counts.size !== 1)
    problems.push(`${phase}: shards of different counts ${[...counts].join(", ")}`);
  const count = [...counts][0] as number;
  const indices = new Set(files.map((x) => Number(x.m?.[1])));
  for (let i = 0; i < count; i++)
    if (!indices.has(i)) problems.push(`${phase}: shard ${i} of ${count} is missing`);
  // The scripts that ran are compared with this checkout, wherever the outputs are.
  const root = repoRoot(fileURLToPath(import.meta.url));
  const rows: Row[] = [];
  const commits = new Set<string>();
  const runtimes = new Set<string>();
  let files0: string | undefined;
  for (const { f } of files) {
    const file = path.join(dir, f);
    if (!existsSync(metaPath(file))) {
      problems.push(`${f}: no sidecar`);
      continue;
    }
    const meta = JSON.parse(readFileSync(metaPath(file), "utf8")) as Meta;
    if (!meta.complete) problems.push(`${f}: the sidecar says the run did not finish`);
    if (meta.outputSha256 !== sha256(file)) problems.push(`${f}: sha256 differs from its sidecar`);
    if (meta.phase !== phase) problems.push(`${f}: sidecar phase ${meta.phase}`);
    if (meta.reps !== reps && !smoke) problems.push(`${f}: ${meta.reps} repetitions, not ${reps}`);
    if (phase === "screen" && meta.confirmSe !== 0.0005 && !smoke)
      problems.push(`${f}: confirmations to SE ${meta.confirmSe}, not 0.0005`);
    commits.add(meta.commit);
    if (meta.runtime === undefined) problems.push(`${f}: the sidecar records no runtime`);
    runtimes.add(runtimeKey(meta.runtime));
    const hashes = JSON.stringify(meta.files);
    if (files0 === undefined) files0 = hashes;
    else if (hashes !== files0) problems.push(`${f}: ran different scripts from the other shards`);
    for (const [script, hash] of Object.entries(meta.files))
      if (sha256(path.join(root, script)) !== hash)
        problems.push(`${f}: ${script} differs from the checked-out file`);
    rows.push(...readTsv(file, columns));
  }
  if (commits.size > 1)
    problems.push(`${phase}: shards ran different commits ${[...commits].join(", ")}`);
  if (runtimes.size > 1)
    problems.push(`${phase}: shards ran on different runtimes: ${[...runtimes].join("; ")}`);
  return { rows, commit: [...commits][0], runtime: [...runtimes][0] };
}

/** Every point appears once: the grid's points, and each G2 cell's refinement steps after it. */
function checkPoints(rows: readonly Row[], problems: string[]): void {
  const all = cells();
  const expected = new Set(all.flatMap((c) => c.points.map((p) => p.id)));
  const refinable = new Set(all.filter((c) => c.refine !== undefined).map((c) => c.id));
  const seen = new Set<string>();
  const refinements = new Map<string, number[]>();
  for (const r of rows) {
    const id = r["id"] as string;
    if (seen.has(id)) problems.push(`${id}: more than once`);
    seen.add(id);
    if (expected.has(id)) continue;
    const m = /^(G2\/[^/]+\/[^/]+)\/s(\d+)$/.exec(id);
    if (m && refinable.has(m[1] as string)) {
      refinements.set(m[1] as string, [...(refinements.get(m[1] as string) ?? []), Number(m[2])]);
      continue;
    }
    problems.push(`${id}: not a point of the study`);
  }
  for (const id of expected) if (!seen.has(id)) problems.push(`${id}: missing`);
  const most = G2_REFINE_WORST * G2_REFINE_STEPS;
  for (const [cell, steps] of refinements) {
    const sorted = steps.toSorted((a, b) => a - b);
    if (sorted.length > most || sorted.some((s, i) => s !== G2_STRUCTURES + i))
      problems.push(
        `${cell}: refinement steps ${sorted.join(",")} are not ${G2_STRUCTURES} onwards`,
      );
  }
}

const num = (r: Row, column: string): number => Number(r[column]);

function select(dir: string, smoke: boolean): void {
  const problems: string[] = [];
  const { rows } = readPhase(dir, "screen", SCREEN_COLUMNS, 6000, smoke, problems);
  checkPoints(rows, problems);
  if (problems.length > 0)
    throw new Error(`the screen outputs fail their checks:\n${problems.join("\n")}`);
  const checkable = rows.filter((r) => r["test"] === "permutation");
  const chosen = new Map<string, Row>();
  for (const r of checkable)
    if (r["stage"] === "confirmed" || r["fails"] === "true") chosen.set(r["id"] as string, r);
  for (const g of new Set(checkable.map((r) => r["generator"])))
    for (const r of checkable
      .filter((x) => x["generator"] === g)
      .toSorted((a, b) => num(b, "value") - num(a, "value"))
      .slice(0, WORST_PER_GENERATOR))
      chosen.set(r["id"] as string, r);
  const points = [...chosen.values()]
    .toSorted((a, b) => ((a["id"] as string) < (b["id"] as string) ? -1 : 1))
    .map((r) => ({
      id: r["id"],
      ...(r["structure"] === "" ? {} : { structure: r["structure"] }),
      value: num(r, "value"),
      se: num(r, "se"),
    }));
  writeFileSync(path.join(dir, "recheck.json"), `${JSON.stringify({ points }, null, 1)}\n`);
  console.log(`${rows.length} points checked; ${points.length} selected for the re-check`);
}

function verdict(dir: string, smoke: boolean): void {
  const problems: string[] = [];
  const screen = readPhase(dir, "screen", SCREEN_COLUMNS, 6000, smoke, problems);
  checkPoints(screen.rows, problems);
  const recheck = readPhase(dir, "recheck", RECHECK_COLUMNS, 20_000, smoke, problems);
  // Both phases ran scripts identical to this checkout (readPhase checks every hash), so their
  // commits may differ only in files that compute nothing, such as this collector. They must share
  // one runtime: outputs compare byte for byte only within one.
  if (screen.runtime !== recheck.runtime)
    problems.push(`the screen ran on ${screen.runtime} and the re-check on ${recheck.runtime}`);
  const selected = (
    JSON.parse(readFileSync(path.join(dir, "recheck.json"), "utf8")) as { points: { id: string }[] }
  ).points.map((p) => p.id);
  const rechecked = new Map(recheck.rows.map((r) => [r["id"] as string, r]));
  if (rechecked.size !== recheck.rows.length)
    problems.push("the re-check has a point more than once");
  for (const id of selected)
    if (!rechecked.has(id)) problems.push(`${id}: selected but not re-checked`);
  for (const id of rechecked.keys())
    if (!selected.includes(id)) problems.push(`${id}: re-checked but not selected`);
  if (problems.length > 0)
    throw new Error(`the outputs fail their checks:\n${problems.join("\n")}`);

  const failures: string[] = [];
  const mustFail: { id: string; value: number; se: number; failed: boolean }[] = [];
  const reported: { id: string; value: number; se: number; fails: boolean }[] = [];
  const failed = (r: Row): boolean =>
    r["fails"] === "true" || rechecked.get(r["id"] as string)?.["fails"] === "true";
  for (const r of screen.rows) {
    const id = r["id"] as string;
    if (r["role"] === "type-I" && failed(r))
      failures.push(
        `${id}: ${num(r, "value").toFixed(4)} ± ${num(r, "se").toFixed(4)}${rechecked.get(id)?.["fails"] === "true" ? " (shipped test)" : ""}`,
      );
    if (r["role"] === "must-fail")
      mustFail.push({
        id,
        value: num(r, "value"),
        se: num(r, "se"),
        failed: r["fails"] === "true",
      });
    if (r["role"] === "reported")
      reported.push({ id, value: num(r, "value"), se: num(r, "se"), fails: failed(r) });
  }
  const harness = mustFail.filter((m) => !m.failed).map((m) => `must-fail ${m.id} did not fail`);

  // Pooled check: the shipped test's type-I error minus the study's, over every re-checked point.
  const diffs = recheck.rows.map((r) => num(r, "value") - num(r, "study_value"));
  const pooledSe =
    Math.sqrt(recheck.rows.reduce((a, r) => a + num(r, "se") ** 2 + num(r, "study_se") ** 2, 0)) /
    Math.max(1, recheck.rows.length);
  const meanDiff = diffs.reduce((a, b) => a + b, 0) / Math.max(1, diffs.length);
  const pooledPasses = Math.abs(meanDiff) <= 3 * pooledSe;
  if (!pooledPasses)
    harness.push(
      `pooled shipped − study ${meanDiff.toFixed(5)} is beyond 3 pooled SE (${pooledSe.toFixed(5)})`,
    );

  // One trial per case: k1 is the smallest grid k from which every larger grid k passes.
  const r1Fails = (k: number): boolean =>
    screen.rows.some(
      (r) => r["pattern"] === "r1" && r["role"] === "type-I" && num(r, "k") === k && failed(r),
    );
  const k1 =
    R1_CASE_COUNTS.find((_k, i) => R1_CASE_COUNTS.slice(i).every((k) => !r1Fails(k))) ?? null;

  // Run-level shocks: the largest SD at which every point passes, for shared and separate shocks.
  const largestPassing = (shared: boolean, r1: boolean): number | null => {
    const shock = screen.rows.filter(
      (r) =>
        r["generator"] === "4" &&
        r["test"] === "permutation" &&
        (r["family"] ?? "").endsWith(shared ? "-shared" : "-separate") &&
        (r["pattern"] === "r1") === r1,
    );
    const sigmas = [
      ...new Set(shock.map((r) => Number(/^sigma([\d.]+)/.exec(r["family"] as string)?.[1]))),
    ].toSorted((a, b) => a - b);
    let best: number | null = null;
    for (const s of sigmas) {
      if (shock.some((r) => r["family"]?.startsWith(`sigma${s}-`) && failed(r))) break;
      best = s;
    }
    return best;
  };

  const byGenerator = Object.fromEntries(
    [...new Set(screen.rows.map((r) => r["generator"] as string))].map((g) => {
      const rows = screen.rows.filter((r) => r["generator"] === g && r["role"] === "type-I");
      return [
        `G${g}`,
        {
          points: rows.length,
          confirmed: rows.filter((r) => r["stage"] === "confirmed").length,
          worst: rows.length === 0 ? null : Math.max(...rows.map((r) => num(r, "value"))),
          failures: rows.filter(failed).length,
        },
      ];
    }),
  );
  // How close the deciding points come to their bars: the screen's pass line 0.05 − 2·SE, and the
  // fail line estimate − 3·SE = 0.05 of a confirmed or re-checked point. A point within 1e-6 of its
  // bar is recomputed on a second runtime before it counts.
  const distances = screen.rows
    .filter((r) => r["role"] === "type-I")
    .flatMap((r) => {
      const id = r["id"] as string;
      const out = [
        r["stage"] === "confirmed"
          ? { id, stage: "confirmed", distance: ALPHA - (num(r, "value") - 3 * num(r, "se")) }
          : { id, stage: "screen", distance: ALPHA - 2 * num(r, "se") - num(r, "value") },
      ];
      const c = rechecked.get(id);
      if (c !== undefined)
        out.push({ id, stage: "re-check", distance: ALPHA - (num(c, "value") - 3 * num(c, "se")) });
      return out;
    });
  const nearest = distances.reduce<(typeof distances)[number] | undefined>(
    (a, d) => (a === undefined || Math.abs(d.distance) < Math.abs(a.distance) ? d : a),
    undefined,
  );
  const atTheBar = distances.filter((d) => Math.abs(d.distance) < 1e-6);
  const summary = {
    commit: screen.commit,
    recheckCommit: recheck.commit,
    runtime: screen.runtime,
    nearestToBar: nearest ?? null,
    recomputeOnSecondRuntime: atTheBar,
    alpha: ALPHA,
    points: screen.rows.length,
    rechecked: recheck.rows.length,
    passes: failures.length === 0 && harness.length === 0,
    failures,
    harness,
    mustFail,
    pooled: { meanDifference: meanDiff, pooledSe, passes: pooledPasses },
    oneTrialK1: k1,
    largestShockSd: {
      sharedTwoOrThreeTrials: largestPassing(true, false),
      separateTwoOrThreeTrials: largestPassing(false, false),
      sharedOneTrial: largestPassing(true, true),
    },
    byGenerator,
    reported,
    smoke,
  };
  writeFileSync(path.join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  const md = [
    `# Score permutation test: type-I study${smoke ? " (smoke run, not evidence)" : ""}`,
    "",
    `Commit ${screen.commit}. ${screen.rows.length} points, ${recheck.rows.length} re-checked with the shipped test.`,
    "",
    "| Generator | Points | Confirmed | Worst | Failures |",
    "| --- | --- | --- | --- | --- |",
    ...Object.entries(byGenerator).map(
      ([g, v]) =>
        `| ${g} | ${v.points} | ${v.confirmed} | ${v.worst?.toFixed(4) ?? "—"} | ${v.failures} |`,
    ),
    "",
    `- Must-fail checks: ${mustFail.map((m) => `${m.id} ${m.value.toFixed(4)} ${m.failed ? "fails, as it must" : "DID NOT FAIL"}`).join("; ")}`,
    `- Pooled shipped − study: ${meanDiff.toFixed(5)} (3 pooled SE = ${(3 * pooledSe).toFixed(5)}): ${pooledPasses ? "passes" : "FAILS"}`,
    `- One trial per case: k1 = ${k1 ?? "none"}`,
    `- Largest shock SD that passes: shared ${summary.largestShockSd.sharedTwoOrThreeTrials}, separate ${summary.largestShockSd.separateTwoOrThreeTrials}, shared at one trial ${summary.largestShockSd.sharedOneTrial}`,
    `- Failures: ${failures.length === 0 ? "none" : failures.join("; ")}`,
    `- Harness: ${harness.length === 0 ? "every check passes" : harness.join("; ")}`,
    `- Runtime: ${screen.runtime}. Nearest deciding point to its bar: ${nearest === undefined ? "none" : `${nearest.id} (${nearest.stage}), ${nearest.distance.toExponential(2)}`}${atTheBar.length > 0 ? `; ${atTheBar.length} point(s) within 1e-6 of the bar must be recomputed on a second runtime before they count` : ""}`,
    "",
  ].join("\n");
  writeFileSync(path.join(dir, "summary.md"), md);
  console.log(md);
  if (!summary.passes) process.exitCode = 1;
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  const i = args.indexOf("--in");
  const dir = i < 0 ? "results" : (args[i + 1] as string);
  const smoke = args.includes("--smoke");
  if (command === "select") select(dir, smoke);
  else if (command === "verdict") verdict(dir, smoke);
  else throw new RangeError(`the command must be "select" or "verdict", got ${command}`);
}
