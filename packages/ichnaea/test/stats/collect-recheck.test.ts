// The re-check is bound to the screen (scripts/stats/collect-score-type-i.ts,
// `recheckBindingProblems`): the collector rebuilds the re-check list from the screen rows, and
// refuses a list that differs, a shard that ran another list, a missing or extra re-checked point,
// and a re-check row whose study estimate is not the screen's.
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  recheckBindingProblems,
  recheckSelection,
  type Row,
} from "../../scripts/stats/collect-score-type-i.ts";

/** Screen rows of two generators: a confirmed point, a failing one and a few that cleared. */
const screen: Row[] = [
  {
    id: "G1/a",
    generator: "1",
    test: "permutation",
    stage: "confirmed",
    fails: "false",
    value: "0.0501",
    se: "0.0005",
    structure: "",
  },
  {
    id: "G1/b",
    generator: "1",
    test: "permutation",
    stage: "screen",
    fails: "false",
    value: "0.03",
    se: "0.002",
    structure: "",
  },
  {
    id: "G2/c/s0",
    generator: "2",
    test: "permutation",
    stage: "confirmed",
    fails: "true",
    value: "0.06",
    se: "0.0005",
    structure: "[[0.5,0.4]]",
  },
  {
    id: "G8/w",
    generator: "8",
    test: "wald",
    stage: "confirmed",
    fails: "true",
    value: "0.09",
    se: "0.0005",
    structure: "",
  },
];
const listOf = (points: unknown): string => `${JSON.stringify({ points }, null, 1)}\n`;
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
const rowsFor = (list: ReturnType<typeof recheckSelection>): Row[] =>
  list.map((p) => ({
    id: p.id,
    study_value: String(p.value),
    study_se: String(p.se),
    value: "0.05",
    se: "0.0015",
  }));

describe("the re-check is bound to the screen", () => {
  const expected = recheckSelection(screen);
  const text = listOf(expected);

  it("selects every confirmed or failing permutation point and each generator's worst, never another test", () => {
    expect(expected.map((p) => p.id)).toEqual(["G1/a", "G1/b", "G2/c/s0"]);
    expect(expected[2]?.structure).toBe("[[0.5,0.4]]");
  });

  it("accepts the list the screen determines, run by every shard", () => {
    expect(recheckBindingProblems(screen, text, rowsFor(expected), [sha(text), sha(text)])).toEqual(
      [],
    );
  });

  it("refuses a stale list, even when its IDs are still valid", () => {
    const stale = listOf(expected.slice(1));
    const problems = recheckBindingProblems(screen, stale, rowsFor(expected.slice(1)), [
      sha(stale),
    ]);
    expect(problems.some((p) => p.includes("differs from the list"))).toBe(true);
    expect(problems.some((p) => p.includes("G1/a: selected but not re-checked"))).toBe(true);
  });

  it("refuses a list whose estimates are not the screen's", () => {
    const changed = listOf(expected.map((p, i) => (i === 0 ? { ...p, value: 0.04 } : p)));
    const problems = recheckBindingProblems(screen, changed, rowsFor(expected), [sha(changed)]);
    expect(problems.some((p) => p.includes("differs from the list"))).toBe(true);
  });

  it("refuses a shard that ran another list, or recorded none", () => {
    const problems = recheckBindingProblems(screen, text, rowsFor(expected), [
      sha(text),
      "0".repeat(64),
      undefined,
    ]);
    expect(problems.filter((p) => p.includes("ran a different list"))).toHaveLength(2);
  });

  it("refuses a re-check row that carries another estimate, a repeated point and an extra one", () => {
    const rows = rowsFor(expected);
    (rows[0] as Row)["study_value"] = "0.049";
    rows.push(
      { ...(rows[1] as Row) },
      { id: "G1/z", study_value: "0", study_se: "0", value: "0", se: "0" },
    );
    const problems = recheckBindingProblems(screen, text, rows, [sha(text)]);
    expect(problems).toEqual(
      expect.arrayContaining([
        "G1/a: the re-check carries an estimate that is not the screen's",
        "G1/b: re-checked more than once",
        "G1/z: re-checked but not selected",
      ]),
    );
  });
});
