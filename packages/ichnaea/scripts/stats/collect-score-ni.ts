// Collects stage 1 of the score non-inferiority study (scripts/stats/study-score-ni.ts), checks that its
// outputs are complete and unaltered (the checks of scripts/stats/collect-score-type-i.ts), and applies
// the rule that chooses the method.
//
//   node scripts/stats/collect-score-ni.ts structures [--out skips.tsv]
//     Needs no run: the G2 structures kept at every margin for each G2 family, the skip totals per
//     family, and for the concentrated family the distribution of c and the share of the drop its
//     noisy cases carry. --out writes the kept and skipped counts of every cell (family, shape and
//     margin).
//   node scripts/stats/collect-score-ni.ts select --in results/
//     Checks every screen shard, then writes results/confirm.json: every deciding point at truth
//     −margin at which a selectable setting is a candidate (below 0.94 + 2·SE), and the 10 worst
//     points of each named must-fail check.
//   node scripts/stats/collect-score-ni.ts verdict --in results/
//     Checks both phases, judges every setting on its own (the two-stage rule, decision 0006),
//     asserts every named must-fail check, and applies the choice among S-A and the S-B settings
//     with φ_min > 0: eligible settings have no failing point at truth −margin and a passing grid
//     mean; among them the highest median π₀ at an effective margin of 0.10 wins, and on a tie S-A,
//     then S-B with the larger φ_min. Reported points (G4 with separate shocks, G2 at truth 0) are
//     summarised apart and decide nothing. Writes results/summary.json, results/summary.md and
//     results/skips.tsv.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readPhase, type Row } from "./collect-score-type-i.ts";
import {
  G2_NI_REFINE_STEPS,
  G2_NI_REFINE_WORST,
  G2_NI_STRUCTURES,
  MARGINS,
  type NiCell,
  niCells,
  SETTINGS,
} from "./score-ni-points.ts";
import { CONFIRM_COLUMNS, SCREEN_COLUMNS } from "./study-score-ni.ts";

/** Worst points of each named must-fail check that are confirmed, so their failure is confirmed too. */
export const WORST_PER_MUST_FAIL = 10;
const BAR = 0.94;
/** The study's confirmation: blocks of 50,000 to SE ≤ 0.0005 per selectable setting, at most 1,000,000. */
export const CONFIRM_BLOCK = 50_000;
export const CONFIRM_SE = 0.0005;
export const CONFIRM_CAP = 1_000_000;
/** The tie order of the choice: S-A, then S-B with the larger φ_min first. S-C is never selectable. */
export const TIE_ORDER = [
  "S-A",
  "S-B phi_min 0.1",
  "S-B phi_min 0.05",
  "S-B phi_min 0.02",
  "S-B phi_min 0.01",
];

/**
 * The named must-fail checks: a setting and the generator family on which it must fail, with a
 * confirmed point at truth −margin whose coverage + 3·SE is below 0.94. A failure on another family
 * does not satisfy a check. `reported` checks are shown on their own line and decide nothing.
 */
export interface MustFailCheck {
  readonly setting: string;
  readonly family: string;
  readonly matches: (row: Row) => boolean;
  readonly reported: boolean;
}
const familyOf = (r: Row): string => r["family"] as string;
export const MUST_FAIL_CHECKS: readonly MustFailCheck[] = [
  {
    setting: "S-C",
    family: "G3, ν 2 against 50 (either arm)",
    matches: (r) => r["generator"] === "3",
    reported: false,
  },
  {
    setting: "S-C",
    family: "G2 top",
    matches: (r) => r["generator"] === "2" && familyOf(r).startsWith("top-"),
    reported: false,
  },
  {
    setting: "S-B phi_min 0",
    family: "G2 top or floor",
    matches: (r) =>
      r["generator"] === "2" &&
      (familyOf(r).startsWith("top-") || familyOf(r).startsWith("floor-")),
    reported: false,
  },
  {
    setting: "S-B phi_min 0",
    family: "G2 concentrated",
    matches: (r) => r["generator"] === "2" && familyOf(r) === "concentrated",
    reported: true,
  },
];
const settingIndex = (name: string): number => {
  const i = SETTINGS.findIndex((s) => s.name === name);
  if (i < 0) throw new Error(`no setting ${name}`);
  return i;
};
/** A deciding point at truth −margin: the rows that the rule judges and the choice reads. */
const deciding = (r: Row): boolean => r["truth"] === "margin" && r["reported"] === "false";

const se = (p: number, n: number): number => Math.sqrt((p * (1 - p)) / n);
const countsOf = (r: Row): number[] => (r["events"] as string).split(",").map(Number);
const median = (xs: readonly number[]): number => {
  const s = xs.toSorted((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1
    ? (s[mid] as number)
    : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

/** Every expected point appears once; each G2 cell's refinement steps follow its 100 structures. */
function checkPoints(rows: readonly Row[], problems: string[]): void {
  const all = niCells();
  const expected = new Set(all.flatMap((c) => c.points.map((p) => p.id)));
  const refinable = new Set(
    all.filter((c) => c.refine !== undefined && c.points.length > 0).map((c) => c.id),
  );
  const seen = new Set<string>();
  const steps = new Map<string, number[]>();
  for (const r of rows) {
    const id = r["id"] as string;
    if (seen.has(id)) problems.push(`${id}: more than once`);
    seen.add(id);
    if (expected.has(id)) continue;
    const m = /^(G2\/[^/]+\/[^/]+\/m[\d.]+)\/s(\d+)$/.exec(id);
    if (m && refinable.has(m[1] as string)) {
      steps.set(m[1] as string, [...(steps.get(m[1] as string) ?? []), Number(m[2])]);
      continue;
    }
    problems.push(`${id}: not a point of the study`);
  }
  for (const id of expected) if (!seen.has(id)) problems.push(`${id}: missing`);
  const most = G2_NI_REFINE_WORST * G2_NI_REFINE_STEPS;
  for (const [cell, s] of steps)
    if (s.length > most || s.some((x) => x < G2_NI_STRUCTURES || x >= G2_NI_STRUCTURES + most))
      problems.push(
        `${cell}: refinement steps ${s.join(",")} are outside ${G2_NI_STRUCTURES} to ${G2_NI_STRUCTURES + most - 1}`,
      );
}

/** Minimum, median and maximum, to two decimals. */
const quantiles = (xs: number[]): string => {
  const s = xs.toSorted((a, b) => a - b);
  const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * s.length))] as number;
  return s.length === 0 ? "—" : `${q(0).toFixed(2)} / ${q(0.5).toFixed(2)} / ${q(1).toFixed(2)}`;
};

/** A cell's family, shape and margin (and truth), from its ID. */
function cellKey(cell: NiCell): { family: string; shape: string; margin: string; truth: string } {
  const parts = cell.id.split("/");
  const margin = parts.find((x) => /^m[\d.]+$/.test(x)) ?? "";
  const truth = parts.includes("zero") ? "zero" : "margin";
  return {
    family: `${parts[0]}/${parts[1]}`,
    shape: parts[2] as string,
    margin: margin.slice(1),
    truth,
  };
}

/** Kept and skipped counts per cell, every family: a TSV with one row per (family, shape, margin, truth). */
export function skipTable(all: readonly NiCell[]): string {
  const rows = new Map<string, { kept: number; skipped: number }>();
  for (const cell of all) {
    const k = cellKey(cell);
    const key = [k.family, k.shape, k.margin, k.truth].join("\t");
    const r = rows.get(key) ?? { kept: 0, skipped: 0 };
    r.kept += cell.points.length;
    r.skipped += cell.skipped ?? 0;
    rows.set(key, r);
  }
  return `family\tshape\tmargin\ttruth\tkept\tskipped\n${[...rows]
    .map(([key, r]) => `${key}\t${r.kept}\t${r.skipped}\n`)
    .join("")}`;
}

/** Skipped structures or points per family, over every cell. */
export function skipTotals(all: readonly NiCell[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const cell of all) {
    const k = cellKey(cell);
    const family = k.truth === "zero" ? `${k.family} (truth 0)` : k.family;
    out[family] = (out[family] ?? 0) + (cell.skipped ?? 0);
  }
  return out;
}

function structures(out: string | undefined): void {
  const all = niCells();
  const g2 = all.filter((c) => c.refine !== undefined);
  const families = [...new Set(g2.map((c) => c.id.split("/")[1] as string))];
  const lines = [
    `| Margin | ${families.join(" | ")} |`,
    `| --- |${families.map(() => " --- |").join("")}`,
  ];
  for (const m of MARGINS) {
    const kept = families.map((family) => {
      const cs = g2.filter(
        (c) => c.id.startsWith(`G2/${family}/`) && c.id.endsWith(`/m${m.toFixed(3)}`),
      );
      return `${cs.reduce((a, c) => a + c.points.length, 0)}/${cs.length * G2_NI_STRUCTURES}`;
    });
    lines.push(`| ${m.toFixed(3)} | ${kept.join(" | ")} |`);
  }
  const concentrated = g2.filter((c) => c.id.startsWith("G2/concentrated/"));
  const perCell = concentrated.map((c) => ({
    id: c.id,
    kept: c.points.length,
    c: quantiles(c.points.map((p) => p.params["c"] as number)),
    noisyShare: quantiles(c.points.map((p) => p.params["noisyShare"] as number)),
  }));
  console.log(
    ["G2 structures kept (of 100 per cell, summed over shapes), every margin:", ...lines].join(
      "\n",
    ),
  );
  console.log("\nskipped per family:");
  for (const [family, n] of Object.entries(skipTotals(all))) console.log(`  ${family}: ${n}`);
  if (out !== undefined) {
    writeFileSync(out, skipTable(all));
    console.log(`\nkept and skipped per cell and margin: ${out}`);
  }
  console.log(
    "\nconcentrated family, per cell: kept, c (min / median / max), noisy share (min / median / max)",
  );
  for (const r of perCell) console.log(`${r.id}\t${r.kept}\t${r.c}\t${r.noisyShare}`);
  const trigger = concentrated.filter((c) => {
    const k = Number(/\/k(\d+)-/.exec(c.id)?.[1]);
    const m = Number(/\/m([\d.]+)$/.exec(c.id)?.[1]);
    return k <= 30 && m >= 0.1 && c.points.length < 50;
  });
  console.log(`\nB.6 trigger (k ≤ 30, m ≥ 0.10, fewer than 50 kept): ${trigger.length} cell(s)`);
}

/** One point of the confirmation list: its ID, and its stored structure for a refinement step. */
export interface ConfirmPoint {
  readonly id: string;
  readonly structure?: string;
}

/**
 * The confirmation list that the screen outputs determine: every deciding point at truth −margin
 * where a selectable setting is a candidate, and the 10 worst points of each named must-fail check
 * on its family, sorted by ID. Reported points are never confirmed. `select` writes it, and
 * `verdict` rebuilds it to check the list the confirmation ran.
 */
export function confirmSelection(rows: readonly Row[]): ConfirmPoint[] {
  const atMargin = rows.filter(deciding);
  const chosen = new Map<string, Row>();
  for (const r of atMargin) {
    const reps = Number(r["reps"]);
    const counts = countsOf(r);
    SETTINGS.forEach((s, i) => {
      const p = (counts[i] as number) / reps;
      if (s.role === "candidate" && p < BAR + 2 * se(p, reps)) chosen.set(r["id"] as string, r);
    });
  }
  for (const check of MUST_FAIL_CHECKS) {
    const i = settingIndex(check.setting);
    for (const r of atMargin
      .filter(check.matches)
      .toSorted(
        (a, b) =>
          (countsOf(a)[i] as number) / Number(a["reps"]) -
          (countsOf(b)[i] as number) / Number(b["reps"]),
      )
      .slice(0, WORST_PER_MUST_FAIL))
      chosen.set(r["id"] as string, r);
  }
  return [...chosen.values()]
    .toSorted((a, b) => ((a["id"] as string) < (b["id"] as string) ? -1 : 1))
    .map((r) => ({
      id: r["id"] as string,
      ...(r["structure"] === "" ? {} : { structure: r["structure"] as string }),
    }));
}

/**
 * The checks that bind the confirmation to the screen: the list equals the one the screen outputs
 * determine, every confirmation sidecar ran that very list (its sha256), and every selected point
 * was confirmed once and no other. A candidate left unconfirmed would otherwise be judged on its
 * screening estimate. Returns the problems, empty when everything holds.
 */
export function confirmBindingProblems(
  screenRows: readonly Row[],
  listText: string,
  confirmRows: readonly Row[],
  sidecarSha256s: readonly (string | undefined)[],
): string[] {
  const problems: string[] = [];
  const expected = confirmSelection(screenRows);
  const listed = (JSON.parse(listText) as { points: ConfirmPoint[] }).points;
  if (JSON.stringify(listed) !== JSON.stringify(expected))
    problems.push("confirm.json differs from the list that the screen outputs determine");
  const listSha = createHash("sha256").update(listText).digest("hex");
  sidecarSha256s.forEach((sha, i) => {
    if (sha !== listSha)
      problems.push(`confirmation shard ${i}: ran a different list (${sha ?? "none recorded"})`);
  });
  const wanted = new Set(expected.map((p) => p.id));
  const seen = new Set<string>();
  for (const r of confirmRows) {
    const id = r["id"] as string;
    if (seen.has(id)) problems.push(`${id}: confirmed more than once`);
    seen.add(id);
    if (!wanted.has(id)) problems.push(`${id}: confirmed but not selected`);
  }
  for (const id of wanted) if (!seen.has(id)) problems.push(`${id}: selected but not confirmed`);
  return problems;
}

/**
 * Every confirmation row ran whole blocks of 50,000, and every selectable setting's standard error
 * at its own estimate is at most 0.0005, unless the row reached the 1,000,000 cap, where it stopped
 * and says it was capped. A capped row is reported for review, and only there is an SE above 0.0005
 * accepted. Returns the problems and the capped IDs.
 */
export function confirmSeProblems(
  rows: readonly Row[],
  smoke: boolean,
): { problems: string[]; capped: string[] } {
  const problems: string[] = [];
  const capped: string[] = [];
  for (const r of rows) {
    const id = r["id"] as string;
    const reps = Number(r["reps"]);
    const counts = countsOf(r);
    const wide = SETTINGS.flatMap((s, i) => {
      if (s.role !== "candidate") return [];
      const p = (counts[i] as number) / reps;
      return se(p, reps) > CONFIRM_SE ? [s.name] : [];
    });
    if (r["capped"] === "true") {
      capped.push(id);
      if (!smoke && reps !== CONFIRM_CAP)
        problems.push(`${id}: capped at ${reps} repetitions, not ${CONFIRM_CAP}`);
      continue;
    }
    if (r["capped"] !== "false") problems.push(`${id}: capped is "${r["capped"]}"`);
    if (smoke) continue;
    if (!(reps >= CONFIRM_BLOCK && reps % CONFIRM_BLOCK === 0 && reps < CONFIRM_CAP))
      problems.push(
        `${id}: ${reps} repetitions are not whole blocks of ${CONFIRM_BLOCK} below the cap`,
      );
    if (wide.length > 0)
      problems.push(`${id}: SE above ${CONFIRM_SE} for ${wide.join(", ")} and not capped`);
  }
  return { problems, capped };
}

/** One named must-fail check's result: it holds when a confirmed point of its family fails. */
export interface MustFailResult {
  readonly setting: string;
  readonly family: string;
  readonly reported: boolean;
  readonly points: number;
  readonly confirmed: number;
  readonly confirmedFailures: number;
  readonly worstConfirmed: number | null;
  readonly failed: boolean;
}

/** Applies every named must-fail check to the deciding screen rows and their confirmations. */
export function mustFailResults(
  screenRows: readonly Row[],
  confirmed: ReadonlyMap<string, Row>,
): MustFailResult[] {
  return MUST_FAIL_CHECKS.map((check) => {
    const i = settingIndex(check.setting);
    const rows = screenRows.filter((r) => deciding(r) && check.matches(r));
    let confirmedCount = 0;
    let failures = 0;
    let worst: number | null = null;
    for (const r of rows) {
      const c = confirmed.get(r["id"] as string);
      if (c === undefined) continue;
      confirmedCount++;
      const reps = Number(c["reps"]);
      const p = (countsOf(c)[i] as number) / reps;
      worst = worst === null ? p : Math.min(worst, p);
      if (p + 3 * se(p, reps) < BAR) failures++;
    }
    return {
      setting: check.setting,
      family: check.family,
      reported: check.reported,
      points: rows.length,
      confirmed: confirmedCount,
      confirmedFailures: failures,
      worstConfirmed: worst,
      failed: failures > 0,
    };
  });
}

/** The harness passes only when every named, non-reported must-fail check failed where named. */
export const harnessPasses = (results: readonly MustFailResult[]): boolean =>
  results.filter((m) => !m.reported).every((m) => m.failed);

/**
 * The choice: among the selectable settings (S-A and S-B with φ_min > 0) with no failing point and a
 * passing grid mean, the highest median π₀ at 0.10, ties in TIE_ORDER. Undefined when none is
 * eligible: non-inferiority on scores stays estimate-only.
 */
export function choose<
  T extends {
    name: string;
    role: string;
    failures: readonly unknown[];
    gridMeanPasses: boolean;
    medianPi0AtMargin010: number;
  },
>(results: readonly T[]): { eligible: T[]; chosen: T | undefined } {
  const eligible = results.filter(
    (r) =>
      r.role === "candidate" &&
      TIE_ORDER.includes(r.name) &&
      r.failures.length === 0 &&
      r.gridMeanPasses,
  );
  const chosen = eligible.toSorted(
    (a, b) =>
      b.medianPi0AtMargin010 - a.medianPi0AtMargin010 ||
      TIE_ORDER.indexOf(a.name) - TIE_ORDER.indexOf(b.name),
  )[0];
  return { eligible, chosen };
}

function select(dir: string, smoke: boolean): void {
  const problems: string[] = [];
  const { rows } = readPhase(dir, "screen", SCREEN_COLUMNS, 6000, smoke, problems);
  checkPoints(rows, problems);
  if (problems.length > 0)
    throw new Error(`the screen outputs fail their checks:\n${problems.join("\n")}`);
  const points = confirmSelection(rows);
  writeFileSync(path.join(dir, "confirm.json"), `${JSON.stringify({ points }, null, 1)}\n`);
  console.log(`${rows.length} points checked; ${points.length} selected for confirmation`);
}

interface SettingResult {
  readonly name: string;
  readonly role: string;
  readonly points: number;
  readonly confirmed: number;
  readonly failures: readonly string[];
  readonly worst: number;
  readonly gridMean: number;
  readonly gridMeanPasses: boolean;
  readonly medianPi0AtMargin010: number;
}

function verdict(dir: string, smoke: boolean): void {
  const problems: string[] = [];
  const screen = readPhase(dir, "screen", SCREEN_COLUMNS, 6000, smoke, problems);
  checkPoints(screen.rows, problems);
  const confirmPhase = readPhase(dir, "confirm", CONFIRM_COLUMNS, CONFIRM_BLOCK, smoke, problems);
  const { problems: seProblems, capped } = confirmSeProblems(confirmPhase.rows, smoke);
  problems.push(...seProblems);
  // The confirmation is bound to the screen: the list, and the list each shard ran.
  const sidecars = readdirSync(dir)
    .filter((f) => /^confirm-\d+-of-\d+\.tsv\.meta\.json$/.test(f))
    .map(
      (f) =>
        (JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { pointsSha256?: string })
          .pointsSha256,
    );
  problems.push(
    ...confirmBindingProblems(
      screen.rows,
      readFileSync(path.join(dir, "confirm.json"), "utf8"),
      confirmPhase.rows,
      sidecars,
    ),
  );
  const confirmed = new Map(confirmPhase.rows.map((r) => [r["id"] as string, r]));
  // One runtime for every shard of both phases: outputs compare byte for byte only within one.
  if (screen.runtime !== confirmPhase.runtime)
    problems.push(
      `the screen ran on ${screen.runtime} and the confirmation on ${confirmPhase.runtime}`,
    );
  if (problems.length > 0)
    throw new Error(`the outputs fail their checks:\n${problems.join("\n")}`);

  const atMargin = screen.rows.filter(deciding);
  const designed = atMargin.filter((r) => r["generator"] !== "2");
  const zeroAt010 = screen.rows.filter(
    (r) => r["truth"] === "zero" && r["reported"] === "false" && Number(r["margin"]) === 0.1,
  );
  const results: SettingResult[] = SETTINGS.map((s, i) => {
    const failures: string[] = [];
    let worst = 1;
    let confirmedCount = 0;
    for (const r of atMargin) {
      const id = r["id"] as string;
      const c = confirmed.get(id);
      const reps = Number((c ?? r)["reps"]);
      const p = (countsOf(c ?? r)[i] as number) / reps;
      const s2 = se(p, reps);
      worst = Math.min(worst, p);
      if (c !== undefined) confirmedCount++;
      // A confirmed point fails below 0.94 by 3·SE; a screened point that was a candidate for this
      // setting but not confirmed (a must-fail or reported setting) is judged the same way.
      if (p + 3 * s2 < BAR)
        failures.push(`${id}: ${p.toFixed(4)} ± ${s2.toFixed(4)}${c ? " confirmed" : " screened"}`);
    }
    const coverages = designed.map((r) => (countsOf(r)[i] as number) / Number(r["reps"]));
    const gridMean = coverages.reduce((a, b) => a + b, 0) / coverages.length;
    const gridSe =
      Math.sqrt(
        designed.reduce((a, r, j) => a + se(coverages[j] as number, Number(r["reps"])) ** 2, 0),
      ) / coverages.length;
    return {
      name: s.name,
      role: s.role,
      points: atMargin.length,
      confirmed: confirmedCount,
      failures,
      worst,
      gridMean,
      gridMeanPasses: gridMean + 3 * gridSe >= 0.95,
      medianPi0AtMargin010: median(
        zeroAt010.map((r) => 1 - (countsOf(r)[i] as number) / Number(r["reps"])),
      ),
    };
  });
  const { eligible, chosen } = choose(results);
  const mustFail = mustFailResults(screen.rows, confirmed);
  // Reported only: G4 with separate shocks at truth −margin (worst coverage per setting), and the
  // median π₀ at 0.10 of G4 with separate shocks and of G2 at truth 0.
  const reportedRows = screen.rows.filter((r) => r["reported"] === "true");
  const reportedGroups = [
    [
      "G4 separate shocks, truth −margin",
      (r: Row) => r["generator"] === "4" && r["truth"] === "margin",
    ],
    [
      "G4 separate shocks, truth 0 at 0.10",
      (r: Row) => r["generator"] === "4" && r["truth"] === "zero" && Number(r["margin"]) === 0.1,
    ],
    ["G2 at truth 0, at 0.10", (r: Row) => r["generator"] === "2"],
  ] as const;
  const reported = reportedGroups.map(([name, match]) => {
    const rows = reportedRows.filter(match);
    return {
      name,
      points: rows.length,
      bySetting: SETTINGS.map((s, i) => {
        const rates = rows.map((r) => (countsOf(r)[i] as number) / Number(r["reps"]));
        return {
          setting: s.name,
          // At truth −margin the rate is the coverage; at truth 0 its complement is π₀.
          value:
            rates.length === 0
              ? null
              : name.includes("truth −margin")
                ? Math.min(...rates)
                : median(rates.map((x) => 1 - x)),
        };
      }),
    };
  });
  const all = niCells();
  writeFileSync(path.join(dir, "skips.tsv"), skipTable(all));
  const skipped = skipTotals(all);
  // How close the deciding points come to their bars, for the candidate settings at truth −margin:
  // the screen's pass line 0.94 + 2·SE, and the fail line estimate + 3·SE = 0.94 of a confirmed
  // point. A point within 1e-6 of its bar is recomputed on a second runtime before it counts.
  const distances = atMargin.flatMap((r) => {
    const id = r["id"] as string;
    const c = confirmed.get(id);
    const reps = Number((c ?? r)["reps"]);
    const counts = countsOf(c ?? r);
    return SETTINGS.flatMap((s, i) => {
      if (s.role !== "candidate") return [];
      const p = (counts[i] as number) / reps;
      const d = c === undefined ? p - (BAR + 2 * se(p, reps)) : p + 3 * se(p, reps) - BAR;
      return [
        { id, setting: s.name, stage: c === undefined ? "screen" : "confirmed", distance: d },
      ];
    });
  });
  const nearest = distances.reduce<(typeof distances)[number] | undefined>(
    (a, d) => (a === undefined || Math.abs(d.distance) < Math.abs(a.distance) ? d : a),
    undefined,
  );
  const atTheBar = distances.filter((d) => Math.abs(d.distance) < 1e-6);
  const summary = {
    commit: screen.commit,
    confirmCommit: confirmPhase.commit,
    runtime: screen.runtime,
    nearestToBar: nearest ?? null,
    recomputeOnSecondRuntime: atTheBar,
    points: screen.rows.length,
    confirmed: confirmPhase.rows.length,
    chosen: chosen?.name ?? null,
    eligible: eligible.map((r) => r.name),
    mustFail,
    harnessPasses: harnessPasses(mustFail),
    cappedForReview: capped,
    reported,
    skipped,
    settings: results.map((r) => ({
      ...r,
      failures: r.failures.slice(0, 50),
      failureCount: r.failures.length,
    })),
    smoke,
  };
  writeFileSync(path.join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  const md = [
    `# Score non-inferiority, stage 1${smoke ? " (smoke run, not evidence)" : ""}`,
    "",
    `Commit ${screen.commit}, runtime ${screen.runtime}. ${screen.rows.length} points; ${confirmPhase.rows.length} confirmed.`,
    `Nearest deciding point to its bar: ${nearest === undefined ? "none" : `${nearest.id}, ${nearest.setting} (${nearest.stage}), ${nearest.distance.toExponential(2)}`}${atTheBar.length > 0 ? `; ${atTheBar.length} within 1e-6 must be recomputed on a second runtime before they count` : ""}.`,
    "",
    "| Setting | Role | Worst coverage | Failing points | Grid mean | Median π₀ at 0.10 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...results.map(
      (r) =>
        `| ${r.name} | ${r.role} | ${r.worst.toFixed(4)} | ${r.failures.length} | ${r.gridMean.toFixed(4)}${r.gridMeanPasses ? "" : " (fails)"} | ${r.medianPi0AtMargin010.toFixed(3)} |`,
    ),
    "",
    `- Eligible: ${eligible.map((r) => r.name).join(", ") || "none"}`,
    `- Chosen: ${chosen?.name ?? "none: non-inferiority on scores stays estimate-only"}`,
    "",
    "| Must-fail check | On | Confirmed points | Confirmed failures | Worst confirmed | Result |",
    "| --- | --- | --- | --- | --- | --- |",
    ...mustFail.map(
      (m) =>
        `| ${m.setting} | ${m.family} | ${m.confirmed} of ${m.points} | ${m.confirmedFailures} | ${m.worstConfirmed?.toFixed(4) ?? "—"} | ${m.reported ? (m.failed ? "fails (reported)" : "does not fail (reported)") : m.failed ? "fails, as it must" : "DID NOT FAIL"} |`,
    ),
    "",
    `- Harness: ${harnessPasses(mustFail) ? "every named must-fail check fails where named" : "BROKEN: a named must-fail check did not fail"}`,
    `- Capped confirmations, reported for review (SE above 0.0005 accepted only here): ${capped.length === 0 ? "none" : capped.join(", ")}`,
    `- Skipped per family: ${
      Object.entries(skipped)
        .filter(([, n]) => n > 0)
        .map(([f, n]) => `${f} ${n}`)
        .join("; ") || "none"
    }. Per cell and margin: skips.tsv.`,
    "",
    "Reported only, deciding nothing:",
    "",
    `| Group | Points | ${SETTINGS.map((x) => x.name).join(" | ")} |`,
    `| --- | --- |${SETTINGS.map(() => " --- |").join("")}`,
    ...reported.map(
      (g) =>
        `| ${g.name} | ${g.points} | ${g.bySetting.map((b) => b.value?.toFixed(4) ?? "—").join(" | ")} |`,
    ),
    "",
  ].join("\n");
  writeFileSync(path.join(dir, "summary.md"), md);
  console.log(md);
  if (!summary.harnessPasses) process.exitCode = 1;
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  const i = args.indexOf("--in");
  const dir = i < 0 ? "results" : (args[i + 1] as string);
  const smoke = args.includes("--smoke");
  const o = args.indexOf("--out");
  if (command === "structures") structures(o < 0 ? undefined : args[o + 1]);
  else if (command === "select") select(dir, smoke);
  else if (command === "verdict") verdict(dir, smoke);
  else
    throw new RangeError(`the command must be "structures", "select" or "verdict", got ${command}`);
}
