// VALIDATION.md, "Results of the CI gate", states each grid's result from the pull-request run. Each
// study checks its own row, so the page cannot drift from what CI runs.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REPS, type Rule, type Verdict } from "./simulate.ts";

/** The screening repetitions of the run that the table records: the pull-request run. */
export const DOCUMENTED_REPS = 6000;

export const VALIDATION_PAGE: string = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "src", "stats", "VALIDATION.md"),
  "utf8",
);

/** The rows of the results table, by grid title. */
export function documentedRows(page: string = VALIDATION_PAGE): Map<string, string[]> {
  const section = page.split("\n## Results of the CI gate\n")[1]?.split("\n## ")[0] ?? "";
  const rows = new Map<string, string[]>();
  for (const line of section.split("\n")) {
    if (!line.startsWith("| `")) continue;
    const [title, ...cells] = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    rows.set((title as string).replace(/^`|`$/g, ""), cells);
  }
  return rows;
}

/** A grid's row as the table states it: points, exact, confirmed, the worst point and the mean. */
export function rowOf(rule: Rule, verdict: Verdict): string[] {
  const { estimates } = verdict;
  const coverage = rule.kind === "coverage";
  const worst = estimates.reduce((a, e) =>
    (coverage ? e.value < a.value : e.value > a.value) ? e : a,
  );
  const mean = estimates.reduce((a, e) => a + e.value, 0) / estimates.length;
  return [
    String(estimates.length),
    String(estimates.filter((e) => e.stage === "exact").length),
    String(estimates.filter((e) => e.stage === "confirmed").length),
    `${coverage ? "minimum" : "maximum"} ${worst.value.toFixed(4)}${worst.stage === "exact" ? "" : ` ± ${worst.se.toFixed(4)}`} (${worst.stage}), ${worst.label}`,
    mean.toFixed(4),
  ];
}

/**
 * The cells of a grid's row that this run must reproduce: all of them at the documented
 * repetitions, and the points and exact counts at any other (the nightly run).
 */
export function documented(
  rule: Rule,
  verdict: Verdict,
): { readonly run: string[]; readonly page: string[] | undefined } {
  const page = documentedRows().get(verdict.title);
  const run = rowOf(rule, verdict);
  return REPS === DOCUMENTED_REPS
    ? { run, page }
    : { run: run.slice(0, 2), page: page?.slice(0, 2) };
}
