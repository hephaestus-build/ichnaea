// The re-check is bound to the screen (scripts/stats/collect-score-type-i.ts,
// `recheckBindingProblems`): the collector rebuilds the re-check list from the screen rows, and
// refuses a list that differs, a shard that ran another list, and a missing or extra re-checked
// point. The re-check computes its own estimates, so the list carries none.
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  recheckBindingProblems,
  recheckSelection,
  type Row,
} from "../../scripts/stats/collect-score-type-i.ts";

/** A screen row: its per-level counts at `reps`, and what the runner made of them. */
const row = (
  id: string,
  generator: string,
  stage: string,
  fails: boolean,
  hits: string,
  reps: number,
  extra: Partial<Row> = {},
): Row => ({
  id,
  generator,
  role: "type-I",
  test: "permutation",
  stage,
  fails: String(fails),
  hits,
  reps: String(reps),
  structure: "",
  ...extra,
});

/** Screen rows of two generators: a confirmed point, a failing one and a few that cleared. */
const screen: Row[] = [
  row("G1/a", "1", "confirmed", false, "9600,4800,3200,2400", 192_000),
  row("G1/b", "1", "screen", false, "180,90,60,45", 6_000),
  row("G2/c/s0", "2", "confirmed", true, "12000,6000,4000,3000", 200_000, {
    structure: "[[0.5,0.4]]",
  }),
  row("G8/w", "8", "confirmed", true, "18000,9000,6000,4500", 200_000, {
    role: "must-fail",
    test: "wald",
  }),
];
const listOf = (points: unknown): string => `${JSON.stringify({ points }, null, 1)}\n`;
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
const rowsFor = (ids: readonly string[]): Row[] => ids.map((id) => ({ id, reps: "20000" }));

describe("the re-check is bound to the screen", () => {
  const expected = recheckSelection(screen);
  const text = listOf(expected);
  const ids = expected.map((p) => p.id);

  it("selects every confirmed or failing permutation point and each generator's worst, never another test", () => {
    expect(ids).toEqual(["G1/a", "G1/b", "G2/c/s0"]);
    expect(expected[2]).toEqual({ id: "G2/c/s0", structure: "[[0.5,0.4]]" });
  });

  it("accepts the list the screen determines, run by every shard", () => {
    expect(recheckBindingProblems(screen, text, rowsFor(ids), [sha(text), sha(text)])).toEqual([]);
  });

  it("refuses a stale list, even when its IDs are still valid", () => {
    const stale = listOf(expected.slice(1));
    const problems = recheckBindingProblems(screen, stale, rowsFor(ids.slice(1)), [sha(stale)]);
    expect(problems.some((p) => p.includes("differs from the list"))).toBe(true);
    expect(problems).toContain("G1/a: selected but not re-checked");
  });

  it("refuses a list with another structure", () => {
    const changed = listOf(
      expected.map((p, i) => (i === 2 ? { ...p, structure: "[[0.5,0.41]]" } : p)),
    );
    const problems = recheckBindingProblems(screen, changed, rowsFor(ids), [sha(changed)]);
    expect(problems.some((p) => p.includes("differs from the list"))).toBe(true);
  });

  it("refuses a shard that ran another list, or recorded none", () => {
    const problems = recheckBindingProblems(screen, text, rowsFor(ids), [
      sha(text),
      "0".repeat(64),
      undefined,
    ]);
    expect(problems.filter((p) => p.includes("ran a different list"))).toHaveLength(2);
  });

  it("refuses a repeated point and an extra one", () => {
    const problems = recheckBindingProblems(
      screen,
      text,
      [...rowsFor(ids), ...rowsFor(["G1/b", "G1/z"])],
      [sha(text)],
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        "G1/b: re-checked more than once",
        "G1/z: re-checked but not selected",
      ]),
    );
  });
});
