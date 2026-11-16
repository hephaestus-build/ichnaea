// Collects the sharded outputs of scripts/study-score-type-i.ts, checks that they are complete and
// unaltered, and applies the rule.
//
//   node scripts/collect-score-type-i.ts select --in results/
//     Checks every screen shard, then writes results/recheck.json: the points the shipped test
//     re-checks (every confirmed or failing point that runs the permutation test, the 10 worst
//     type-I points of each generator, and, reported only, the 10 worst reported points of each).
//
//   node scripts/collect-score-type-i.ts verdict --in results/
//     Checks the screen and re-check shards, applies the rule again to every count (\`judge\`), and
//     writes results/summary.json and results/summary.md.
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
  cells,
  G2_REFINE_STEPS,
  G2_REFINE_WORST,
  G2_STRUCTURES,
  HOLM_REPS,
  R1_CASE_COUNTS,
} from "./score-type-i-points.ts";
import {
  CONFIRM_SE,
  confirmationDone,
  failsAtAnyLevel,
  k1Of,
  LEVELS,
  minConfirmReps,
  needsConfirmation,
  pairedDifference,
  parseCounts,
  pooledCheck,
  se,
  STUDY_RESAMPLES,
  worstness,
} from "./score-type-i-rule.ts";
import { RECHECK_COLUMNS, type Runtime, SCREEN_COLUMNS } from "./study-score-type-i.ts";

/** Worst points of each generator, per role (type-I, and reported), that the shipped test re-checks. */
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
  phase: "screen" | "recheck" | "confirm",
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
function checkPoints(
  rows: readonly Row[],
  skips: Readonly<Record<string, readonly number[]>>,
  problems: string[],
): void {
  const all = cells();
  const expected = new Set(all.flatMap((c) => c.points.map((p) => p.id)));
  const refinable = new Set(all.filter((c) => c.refine !== undefined).map((c) => c.id));
  const seen = new Set<string>();
  for (const r of rows) {
    const id = r["id"] as string;
    if (seen.has(id)) problems.push(`${id}: more than once`);
    seen.add(id);
    if (expected.has(id)) continue;
    const m = /^(G2\/[^/]+\/[^/]+)\/s(\d+)$/.exec(id);
    if (m && refinable.has(m[1] as string)) continue;
    problems.push(`${id}: not a point of the study`);
  }
  for (const id of expected) if (!seen.has(id)) problems.push(`${id}: missing`);
  problems.push(...refinementProblems(rows, skips, refinable));
}

/**
 * Every refined cell accounts for each refinement step s from 500 to 599 exactly once: as a screen
 * row, or as a step the screen recorded as skipped because its perturbation left [0.01, 0.99].
 * Returns the problems, naming the cell and the step.
 */
export function refinementProblems(
  rows: readonly Row[],
  skips: Readonly<Record<string, readonly number[]>>,
  refinable: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  const first = G2_STRUCTURES;
  const last = G2_STRUCTURES + G2_REFINE_WORST * G2_REFINE_STEPS;
  const steps = new Map<string, number[]>([...refinable].map((cell) => [cell, []]));
  for (const r of rows) {
    const m = /^(G2\/[^/]+\/[^/]+)\/s(\d+)$/.exec(r["id"] as string);
    const s = Number(m?.[2]);
    if (m && refinable.has(m[1] as string) && s >= first) steps.get(m[1] as string)?.push(s);
  }
  for (const [cell, skipped] of Object.entries(skips)) {
    if (!refinable.has(cell)) {
      problems.push(`${cell}: skipped refinement steps recorded for a cell that is not refined`);
      continue;
    }
    for (const s of skipped) {
      if ((steps.get(cell) as number[]).includes(s))
        problems.push(`${cell}: refinement step ${s} is both a row and a recorded skip`);
      (steps.get(cell) as number[]).push(s);
    }
  }
  for (const [cell, found] of steps) {
    for (const s of found)
      if (!Number.isInteger(s) || s < first || s >= last)
        problems.push(`${cell}: refinement step ${s} is outside ${first}–${last - 1}`);
    const counted = new Map<number, number>();
    for (const s of found) counted.set(s, (counted.get(s) ?? 0) + 1);
    for (let s = first; s < last; s++) {
      const n = counted.get(s) ?? 0;
      if (n === 0)
        problems.push(`${cell}: refinement step ${s} is neither a row nor a recorded skip`);
      else if (n > 1) problems.push(`${cell}: refinement step ${s} appears ${n} times`);
    }
  }
  return problems;
}

/** The refinement steps that the screen shards recorded as skipped, by cell, from their sidecars. */
function readSkips(dir: string, problems: string[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const f of readdirSync(dir).filter((x) => /^screen-\d+-of-\d+\.tsv\.meta\.json$/.test(x))) {
    const meta = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as {
      refinementSkips?: Record<string, number[]>;
    };
    if (meta.refinementSkips === undefined) {
      problems.push(`${f}: the sidecar records no refinement skips`);
      continue;
    }
    for (const [cell, steps] of Object.entries(meta.refinementSkips))
      out[cell] = [...(out[cell] ?? []), ...steps];
  }
  return out;
}

const num = (r: Row, column: string): number => Number(r[column]);
/** A screen row's final per-level counts and repetitions. */
const finalOf = (r: Row): { hits: number[]; reps: number } => ({
  hits: parseCounts(r["hits"]),
  reps: num(r, "reps"),
});

/** One point of the re-check list: its ID, and its stored structure for a refinement step. */
export interface RecheckPoint {
  readonly id: string;
  readonly structure?: string;
}

/**
 * The re-check list that the screen outputs determine, sorted by ID: every confirmed or failing
 * point that runs the permutation test, whatever its role; the 10 worst type-I points of each
 * generator; and the 10 worst reported points of each generator, which are reported only. "Worst"
 * is the largest estimate/level over the levels. `select` writes it, and `verdict` rebuilds it to
 * check the list the re-check ran.
 */
export function recheckSelection(rows: readonly Row[]): RecheckPoint[] {
  const checkable = rows.filter((r) => r["test"] === "permutation");
  const chosen = new Map<string, Row>();
  for (const r of checkable)
    if (r["stage"] === "confirmed" || r["fails"] === "true") chosen.set(r["id"] as string, r);
  const bad = (r: Row): number => {
    const { hits, reps } = finalOf(r);
    return worstness(hits, reps);
  };
  for (const role of ["type-I", "reported"])
    for (const g of new Set(checkable.map((r) => r["generator"])))
      for (const r of checkable
        .filter((x) => x["generator"] === g && x["role"] === role)
        .toSorted((a, b) => bad(b) - bad(a))
        .slice(0, WORST_PER_GENERATOR))
        chosen.set(r["id"] as string, r);
  return [...chosen.values()]
    .toSorted((a, b) => ((a["id"] as string) < (b["id"] as string) ? -1 : 1))
    .map((r) => ({
      id: r["id"] as string,
      ...(r["structure"] === "" ? {} : { structure: r["structure"] as string }),
    }));
}

/**
 * The checks that bind the re-check to the screen: the list equals the one the screen outputs
 * determine, every re-check sidecar ran that very list (its sha256), and every selected point was
 * re-checked once and no other. Returns the problems, empty when everything holds.
 */
export function recheckBindingProblems(
  screenRows: readonly Row[],
  listText: string,
  recheckRows: readonly Row[],
  sidecarSha256s: readonly (string | undefined)[],
): string[] {
  const problems: string[] = [];
  const expected = recheckSelection(screenRows);
  const listed = (JSON.parse(listText) as { points: RecheckPoint[] }).points;
  if (JSON.stringify(listed) !== JSON.stringify(expected))
    problems.push("recheck.json differs from the list that the screen outputs determine");
  const listSha = createHash("sha256").update(listText).digest("hex");
  sidecarSha256s.forEach((sha, i) => {
    if (sha !== listSha)
      problems.push(`re-check shard ${i}: ran a different list (${sha ?? "none recorded"})`);
  });
  const wanted = new Set(expected.map((p) => p.id));
  const seen = new Set<string>();
  for (const r of recheckRows) {
    const id = r["id"] as string;
    if (seen.has(id)) problems.push(`${id}: re-checked more than once`);
    seen.add(id);
    if (!wanted.has(id)) problems.push(`${id}: re-checked but not selected`);
  }
  for (const id of wanted) if (!seen.has(id)) problems.push(`${id}: selected but not re-checked`);
  return problems;
}

/** The thresholds in effect, printed with every verdict. */
export const THRESHOLDS = {
  levels: "0.05, 0.025, 0.05/3 and 0.0125, from the same repetitions",
  screenRepetitions: 6_000,
  holmRepetitions: HOLM_REPS,
  studyResamples: STUDY_RESAMPLES,
  confirmWhen: "at any level, estimate > level − 2·SE, with SE from the estimate",
  confirmUntil: `SE ≤ ${CONFIRM_SE} at every level, at least ${minConfirmReps(CONFIRM_SE).toLocaleString("en")} repetitions`,
  pointFails: "at any level, estimate − 3·SE > level (confirmed, re-checked or Holm points)",
  recheckRepetitions: 20_000,
  pooled: "per level and pool, fails when mean (shipped − study) > 3 paired pooled SE",
} as const;

/** One pooled check: a pool of re-checked type-I points at one level. */
export interface Pool {
  readonly pool: "lattice" | "monte-carlo" | "mixed";
  readonly level: number;
  readonly points: number;
  readonly meanDifference: number;
  readonly pooledSe: number;
  readonly passes: boolean;
}

/**
 * Applies the rule to checked outputs: the screen rows, and the re-check rows of the points that
 * `recheckSelection` chose. Every count is judged again here; a stage or flag that the counts do not
 * give is a harness problem. A smoke run never passes.
 */
export function judge(
  screenRows: readonly Row[],
  recheckRows: readonly Row[],
  smoke: boolean,
): {
  passes: boolean;
  failures: string[];
  harness: string[];
  mustFail: { id: string; estimate: number; failed: boolean }[];
  pooled: Pool[];
  reportedRechecks: { id: string; shipped: number[]; study: number[]; fails: boolean }[];
  oneTrialK1: number | null;
  largestShockSd: Record<string, number | null>;
  holm: { id: string; familywise: number[]; measures: number[] }[];
  byGenerator: Record<
    string,
    { points: number; confirmed: number; worst: number | null; failures: number }
  >;
  nearestToBar: { id: string; stage: string; level: number; distance: number } | null;
  recomputeOnSecondRuntime: { id: string; stage: string; level: number; distance: number }[];
} {
  const harness: string[] = [];
  const rechecked = new Map<string, { row: Row; fails: boolean }>();
  for (const c of recheckRows) {
    const id = c["id"] as string;
    const fails = failsAtAnyLevel(parseCounts(c["shipped_hits"]), num(c, "reps"));
    if ((c["fails"] === "true") !== fails)
      harness.push(`${id}: the re-check says fails ${c["fails"]}, its counts give ${fails}`);
    rechecked.set(id, { row: c, fails });
  }

  // The rule again, from the counts: the stage, the flag, and the confirmation's stop.
  const fails = new Map<string, boolean>();
  for (const r of screenRows) {
    const id = r["id"] as string;
    const screenHits = parseCounts(r["screen_hits"]);
    const screenReps = num(r, "screen_reps");
    const { hits, reps } = finalOf(r);
    const own = r["test"] === "holm";
    const stage = !own && needsConfirmation(screenHits, screenReps) ? "confirmed" : "screen";
    if (r["stage"] !== stage) harness.push(`${id}: stage ${r["stage"]}, the rule gives ${stage}`);
    if (stage === "screen" && (r["hits"] !== r["screen_hits"] || reps !== screenReps))
      harness.push(`${id}: a screened point's counts differ from its screen's`);
    if (stage === "confirmed" && !smoke && !confirmationDone(hits, reps, CONFIRM_SE))
      harness.push(`${id}: the confirmation stopped before SE ≤ ${CONFIRM_SE} at every level`);
    if (!smoke && screenReps !== (own ? HOLM_REPS : 6_000))
      harness.push(`${id}: ${screenReps} screening repetitions`);
    const f = (stage === "confirmed" || own) && failsAtAnyLevel(hits, reps);
    if ((r["fails"] === "true") !== f)
      harness.push(`${id}: fails ${r["fails"]}, the rule gives ${f}`);
    fails.set(id, f);
  }
  const failed = (r: Row): boolean =>
    fails.get(r["id"] as string) === true || rechecked.get(r["id"] as string)?.fails === true;

  const failures: string[] = [];
  const mustFail: { id: string; estimate: number; failed: boolean }[] = [];
  for (const r of screenRows) {
    const id = r["id"] as string;
    const { hits, reps } = finalOf(r);
    if (r["role"] === "type-I" && failed(r))
      failures.push(
        `${id}: ${hits.map((h) => (h / reps).toFixed(4)).join(", ")}${rechecked.get(id)?.fails === true ? " (shipped test)" : ""}`,
      );
    if (r["role"] === "must-fail")
      mustFail.push({ id, estimate: (hits[0] as number) / reps, failed: fails.get(id) === true });
  }
  harness.push(...mustFail.filter((m) => !m.failed).map((m) => `must-fail ${m.id} did not fail`));
  if (!screenRows.some((r) => r["role"] === "must-fail")) harness.push("no must-fail point ran");

  // The pooled check over the re-checked type-I points, per level, in three pools by the path the
  // shipped test took: exact in every repetition, in none, or in some.
  const roleOf = new Map(screenRows.map((r) => [r["id"] as string, r["role"] as string]));
  const counting = recheckRows.filter((c) => roleOf.get(c["id"] as string) === "type-I");
  const poolOf = (c: Row): Pool["pool"] =>
    num(c, "exact") === num(c, "reps")
      ? "lattice"
      : num(c, "exact") === 0
        ? "monte-carlo"
        : "mixed";
  const pooled: Pool[] = (["lattice", "monte-carlo", "mixed"] as const).flatMap((pool) =>
    LEVELS.map((level, l) => {
      const members = counting
        .filter((c) => poolOf(c) === pool)
        .map((c) =>
          pairedDifference(
            parseCounts(c["n10"])[l] as number,
            parseCounts(c["n01"])[l] as number,
            num(c, "reps"),
          ),
        );
      return { pool, level, ...pooledCheck(members) };
    }),
  );
  for (const p of pooled.filter((x) => !x.passes))
    harness.push(
      `pooled shipped − study, ${p.pool} at ${p.level}: ${p.meanDifference.toFixed(5)} is above 3 pooled SE (${p.pooledSe.toFixed(5)})`,
    );

  const reportedRechecks = recheckRows
    .filter((c) => roleOf.get(c["id"] as string) !== "type-I")
    .map((c) => ({
      id: c["id"] as string,
      shipped: parseCounts(c["shipped_hits"]).map((h) => h / num(c, "reps")),
      study: parseCounts(c["study_hits"]).map((h) => h / num(c, "reps")),
      fails: rechecked.get(c["id"] as string)?.fails === true,
    }));

  // One trial per case: k1 is the smallest grid k from which every larger grid k passes.
  const oneTrialK1 = k1Of(R1_CASE_COUNTS, (k) =>
    screenRows.some(
      (r) => r["pattern"] === "r1" && r["role"] === "type-I" && num(r, "k") === k && failed(r),
    ),
  );

  // Run-level shocks: the largest SD at which every point passes, for shared and separate shocks.
  const largestPassing = (shared: boolean, r1: boolean): number | null => {
    const shock = screenRows.filter(
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

  const holm = screenRows
    .filter((r) => r["test"] === "holm")
    .map((r) => {
      const { hits, reps } = finalOf(r);
      return {
        id: r["id"] as string,
        familywise: hits.map((h) => h / reps),
        measures: (r["measure_hits"] ?? "").split(",").map((h) => Number(h) / reps),
      };
    });

  const byGenerator = Object.fromEntries(
    [...new Set(screenRows.map((r) => r["generator"] as string))].map((g) => {
      const rows = screenRows.filter((r) => r["generator"] === g && r["role"] === "type-I");
      return [
        `G${g}`,
        {
          points: rows.length,
          confirmed: rows.filter((r) => r["stage"] === "confirmed").length,
          worst:
            rows.length === 0
              ? null
              : Math.max(...rows.map((r) => worstness(finalOf(r).hits, finalOf(r).reps))),
          failures: rows.filter(failed).length,
        },
      ];
    }),
  );

  // How close the deciding points come to their bars at each level: the screen's line
  // level − 2·SE, and the fail line estimate − 3·SE = level of a confirmed or re-checked point. A
  // point within 1e-6 of a bar is recomputed on a second runtime before it counts.
  const distances = screenRows
    .filter((r) => r["role"] === "type-I")
    .flatMap((r) => {
      const id = r["id"] as string;
      const { hits, reps } = finalOf(r);
      const out = LEVELS.map((level, l) => {
        const p = (hits[l] as number) / reps;
        return r["stage"] === "confirmed"
          ? { id, stage: "confirmed", level, distance: level - (p - 3 * se(p, reps)) }
          : { id, stage: "screen", level, distance: level - 2 * se(p, reps) - p };
      });
      const c = rechecked.get(id)?.row;
      if (c !== undefined) {
        const shipped = parseCounts(c["shipped_hits"]);
        const n = num(c, "reps");
        LEVELS.forEach((level, l) => {
          const p = (shipped[l] as number) / n;
          out.push({ id, stage: "re-check", level, distance: level - (p - 3 * se(p, n)) });
        });
      }
      return out;
    });
  const nearestToBar = distances.reduce<(typeof distances)[number] | null>(
    (a, d) => (a === null || Math.abs(d.distance) < Math.abs(a.distance) ? d : a),
    null,
  );
  if (smoke) harness.push("a smoke run is not evidence");
  return {
    passes: failures.length === 0 && harness.length === 0,
    failures,
    harness,
    mustFail,
    pooled,
    reportedRechecks,
    oneTrialK1,
    largestShockSd: {
      sharedTwoOrThreeTrials: largestPassing(true, false),
      separateTwoOrThreeTrials: largestPassing(false, false),
      sharedOneTrial: largestPassing(true, true),
      separateOneTrial: largestPassing(false, true),
    },
    holm,
    byGenerator,
    nearestToBar,
    recomputeOnSecondRuntime: distances.filter((d) => Math.abs(d.distance) < 1e-6),
  };
}

function select(dir: string, smoke: boolean): void {
  const problems: string[] = [];
  const { rows } = readPhase(dir, "screen", SCREEN_COLUMNS, 6000, smoke, problems);
  checkPoints(rows, readSkips(dir, problems), problems);
  if (problems.length > 0)
    throw new Error(`the screen outputs fail their checks:\n${problems.join("\n")}`);
  const points = recheckSelection(rows);
  writeFileSync(path.join(dir, "recheck.json"), `${JSON.stringify({ points }, null, 1)}\n`);
  console.log(`${rows.length} points checked; ${points.length} selected for the re-check`);
}

const pct = (xs: readonly number[]): string => xs.map((x) => x.toFixed(4)).join(" / ");
const levelName = (level: number): string => (level === LEVELS[2] ? "0.05/3" : String(level));

function verdict(dir: string, smoke: boolean): void {
  const problems: string[] = [];
  const screen = readPhase(dir, "screen", SCREEN_COLUMNS, 6000, smoke, problems);
  checkPoints(screen.rows, readSkips(dir, problems), problems);
  const recheck = readPhase(dir, "recheck", RECHECK_COLUMNS, 20_000, smoke, problems);
  // Both phases ran scripts identical to this checkout (readPhase checks every hash), so their
  // commits may differ only in files that compute nothing, such as this collector. They must share
  // one runtime: outputs compare byte for byte only within one.
  if (screen.runtime !== recheck.runtime)
    problems.push(`the screen ran on ${screen.runtime} and the re-check on ${recheck.runtime}`);
  // The re-check is bound to the screen: the list, and the list each shard ran.
  const sidecars = readdirSync(dir)
    .filter((f) => /^recheck-\d+-of-\d+\.tsv\.meta\.json$/.test(f))
    .map(
      (f) =>
        (JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { pointsSha256?: string })
          .pointsSha256,
    );
  problems.push(
    ...recheckBindingProblems(
      screen.rows,
      readFileSync(path.join(dir, "recheck.json"), "utf8"),
      recheck.rows,
      sidecars,
    ),
  );
  if (problems.length > 0)
    throw new Error(`the outputs fail their checks:\n${problems.join("\n")}`);

  const j = judge(screen.rows, recheck.rows, smoke);
  const summary = {
    commit: screen.commit,
    recheckCommit: recheck.commit,
    runtime: screen.runtime,
    thresholds: THRESHOLDS,
    points: screen.rows.length,
    rechecked: recheck.rows.length,
    ...j,
    smoke,
  };
  writeFileSync(path.join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  const md = [
    `# Score permutation test: type-I study${smoke ? " (smoke run, not evidence)" : ""}`,
    "",
    `Commit ${screen.commit}. ${screen.rows.length} points, ${recheck.rows.length} re-checked with the shipped test.`,
    "",
    "Thresholds in effect:",
    "",
    ...Object.entries(THRESHOLDS).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "| Generator | Points | Confirmed | Worst estimate/level | Failures |",
    "| --- | --- | --- | --- | --- |",
    ...Object.entries(j.byGenerator).map(
      ([g, v]) =>
        `| ${g} | ${v.points} | ${v.confirmed} | ${v.worst?.toFixed(3) ?? "—"} | ${v.failures} |`,
    ),
    "",
    `- Must-fail checks: ${j.mustFail.map((m) => `${m.id} ${m.estimate.toFixed(4)} ${m.failed ? "fails, as it must" : "DID NOT FAIL"}`).join("; ")}`,
    `- Pooled shipped − study (one-sided, 3 paired pooled SE): ${j.pooled
      .filter((p) => p.points > 0)
      .map(
        (p) =>
          `${p.pool} at ${levelName(p.level)}: ${p.meanDifference.toFixed(5)} (SE ${p.pooledSe.toFixed(5)}, ${p.points} points) ${p.passes ? "passes" : "FAILS"}`,
      )
      .join("; ")}`,
    `- Reported points re-checked: ${j.reportedRechecks.length === 0 ? "none" : j.reportedRechecks.map((c) => `${c.id} shipped ${pct(c.shipped)}, study ${pct(c.study)}`).join("; ")}`,
    `- Holm across four correlated primaries (familywise at 0.05 / 0.025 / 0.05/3 / 0.0125; per measure at 0.05): ${j.holm.map((h) => `${h.id} ${pct(h.familywise)}; ${pct(h.measures)}`).join("; ")}`,
    `- One trial per case: k1 = ${j.oneTrialK1 ?? "none"}`,
    `- Largest shock SD that passes: ${Object.entries(j.largestShockSd)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`,
    `- Failures: ${j.failures.length === 0 ? "none" : j.failures.join("; ")}`,
    `- Harness: ${j.harness.length === 0 ? "every check passes" : j.harness.join("; ")}`,
    `- Runtime: ${screen.runtime}. Nearest deciding point to its bar: ${j.nearestToBar === null ? "none" : `${j.nearestToBar.id} (${j.nearestToBar.stage}, ${levelName(j.nearestToBar.level)}), ${j.nearestToBar.distance.toExponential(2)}`}${j.recomputeOnSecondRuntime.length > 0 ? `; ${j.recomputeOnSecondRuntime.length} point(s) within 1e-6 of a bar must be recomputed on a second runtime before they count` : ""}`,
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
