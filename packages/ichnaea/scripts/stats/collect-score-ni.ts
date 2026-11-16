// Collects stage 1 of the score non-inferiority study (scripts/stats/study-score-ni.ts), checks that its
// outputs are complete and unaltered (the checks of scripts/stats/collect-score-type-i.ts), and applies
// the rule that chooses the method.
//
//   node scripts/stats/collect-score-ni.ts structures
//     Needs no run: the G2 structures kept per family and margin, the skips, and for the
//     concentrated family the distribution of c and the share of the drop its noisy cases carry.
//   node scripts/stats/collect-score-ni.ts select --in results/
//     Checks every screen shard, then writes results/confirm.json: every point at truth −margin at
//     which a candidate setting is a candidate (below 0.94 + 2·SE), and the 10 worst points of each
//     must-fail setting.
//   node scripts/stats/collect-score-ni.ts verdict --in results/
//     Checks both phases, judges every setting on its own (the two-stage rule, decision 0006), and applies the choice: eligible
//     settings have no failing point at truth −margin; among them the highest median π₀ at an
//     effective margin of 0.10 wins, and on a tie S-A, then S-B with the larger φ_min, then S-C.
//     Writes results/summary.json and results/summary.md.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readPhase, type Row } from "./collect-score-type-i.ts";
import {
  G2_NI_REFINE_STEPS,
  G2_NI_REFINE_WORST,
  G2_NI_STRUCTURES,
  MARGINS,
  niCells,
  SETTINGS,
} from "./score-ni-points.ts";
import { CONFIRM_COLUMNS, SCREEN_COLUMNS } from "./study-score-ni.ts";

/** Worst points of each must-fail setting that are confirmed, so their failure is confirmed too. */
export const WORST_PER_MUST_FAIL = 10;
const BAR = 0.94;
/** The tie order of the choice: S-A, S-B with the larger φ_min first, then S-C. */
const TIE_ORDER = [
  "S-A",
  "S-B phi_min 0.1",
  "S-B phi_min 0.05",
  "S-B phi_min 0.02",
  "S-B phi_min 0.01",
  "S-C",
];

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

function structures(): void {
  const g2 = niCells().filter((c) => c.refine !== undefined);
  const families = [...new Set(g2.map((c) => c.id.split("/")[1] as string))];
  const lines = [
    "| Family | " +
      MARGINS.filter((_m, i) => i % 5 === 0)
        .map((m) => `m = ${m}`)
        .join(" | ") +
      " |",
  ];
  lines.push(
    `| --- |${MARGINS.filter((_m, i) => i % 5 === 0)
      .map(() => " --- |")
      .join("")}`,
  );
  for (const family of families) {
    const cells = MARGINS.filter((_m, i) => i % 5 === 0).map((m) => {
      const cs = g2.filter(
        (c) => c.id.startsWith(`G2/${family}/`) && c.id.endsWith(`/m${m.toFixed(3)}`),
      );
      return `${cs.reduce((a, c) => a + c.points.length, 0)}/${cs.length * G2_NI_STRUCTURES}`;
    });
    lines.push(`| ${family} | ${cells.join(" | ")} |`);
  }
  const concentrated = g2.filter((c) => c.id.startsWith("G2/concentrated/"));
  const perCell = concentrated.map((c) => ({
    id: c.id,
    kept: c.points.length,
    c: quantiles(c.points.map((p) => p.params["c"] as number)),
    noisyShare: quantiles(c.points.map((p) => p.params["noisyShare"] as number)),
  }));
  console.log(["G2 structures kept (of 100 per cell), every fifth margin:", ...lines].join("\n"));
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

function select(dir: string, smoke: boolean): void {
  const problems: string[] = [];
  const { rows } = readPhase(dir, "screen", SCREEN_COLUMNS, 6000, smoke, problems);
  checkPoints(rows, problems);
  if (problems.length > 0)
    throw new Error(`the screen outputs fail their checks:\n${problems.join("\n")}`);
  const atMargin = rows.filter((r) => r["truth"] === "margin");
  const chosen = new Map<string, Row>();
  for (const r of atMargin) {
    const reps = Number(r["reps"]);
    const counts = countsOf(r);
    SETTINGS.forEach((s, i) => {
      const p = (counts[i] as number) / reps;
      if (s.role === "candidate" && p < BAR + 2 * se(p, reps)) chosen.set(r["id"] as string, r);
    });
  }
  SETTINGS.forEach((s, i) => {
    if (s.role !== "must-fail") return;
    for (const r of atMargin
      .toSorted(
        (a, b) =>
          (countsOf(a)[i] as number) / Number(a["reps"]) -
          (countsOf(b)[i] as number) / Number(b["reps"]),
      )
      .slice(0, WORST_PER_MUST_FAIL))
      chosen.set(r["id"] as string, r);
  });
  const points = [...chosen.values()]
    .toSorted((a, b) => ((a["id"] as string) < (b["id"] as string) ? -1 : 1))
    .map((r) => ({ id: r["id"], ...(r["structure"] === "" ? {} : { structure: r["structure"] }) }));
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
  const confirmPhase = readPhase(dir, "confirm", CONFIRM_COLUMNS, 190_000, smoke, problems);
  const selected = (
    JSON.parse(readFileSync(path.join(dir, "confirm.json"), "utf8")) as { points: { id: string }[] }
  ).points.map((p) => p.id);
  const confirmed = new Map(confirmPhase.rows.map((r) => [r["id"] as string, r]));
  for (const id of selected)
    if (!confirmed.has(id)) problems.push(`${id}: selected but not confirmed`);
  for (const id of confirmed.keys())
    if (!selected.includes(id)) problems.push(`${id}: confirmed but not selected`);
  if (problems.length > 0)
    throw new Error(`the outputs fail their checks:\n${problems.join("\n")}`);

  const atMargin = screen.rows.filter((r) => r["truth"] === "margin");
  const designed = atMargin.filter((r) => r["generator"] !== "2");
  const zeroAt010 = screen.rows.filter((r) => r["truth"] === "zero" && Number(r["margin"]) === 0.1);
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
  const eligible = results.filter(
    (r) => r.role === "candidate" && r.failures.length === 0 && r.gridMeanPasses,
  );
  const chosen = eligible.toSorted(
    (a, b) =>
      b.medianPi0AtMargin010 - a.medianPi0AtMargin010 ||
      TIE_ORDER.indexOf(a.name) - TIE_ORDER.indexOf(b.name),
  )[0];
  const mustFail = results
    .filter((r) => r.role === "must-fail")
    .map((r) => ({ name: r.name, failed: r.failures.length > 0 }));
  const summary = {
    commit: screen.commit,
    confirmCommit: confirmPhase.commit,
    points: screen.rows.length,
    confirmed: confirmPhase.rows.length,
    chosen: chosen?.name ?? null,
    eligible: eligible.map((r) => r.name),
    mustFail,
    harnessPasses: mustFail.every((m) => m.failed),
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
    `Commit ${screen.commit}. ${screen.rows.length} points; ${confirmPhase.rows.length} confirmed.`,
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
    `- Must-fail checks: ${mustFail.map((m) => `${m.name} ${m.failed ? "fails, as it must" : "DID NOT FAIL"}`).join("; ")}`,
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
  if (command === "structures") structures();
  else if (command === "select") select(dir, smoke);
  else if (command === "verdict") verdict(dir, smoke);
  else
    throw new RangeError(`the command must be "structures", "select" or "verdict", got ${command}`);
}
