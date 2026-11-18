// Stage 1's confirmation is bound to its screen (scripts/stats/collect-score-ni.ts,
// `confirmBindingProblems`): the collector rebuilds the confirmation list from the screen rows, and
// refuses a list that differs, a shard that ran another list, and a missing, repeated or extra
// confirmed point. A candidate left unconfirmed would otherwise be judged on its screening estimate.
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { confirmBindingProblems, confirmSelection } from "../../scripts/stats/collect-score-ni.ts";
import type { Row } from "../../scripts/stats/collect-score-type-i.ts";
import { SETTINGS } from "../../scripts/stats/score-ni-points.ts";

/** Event counts over 6,000 repetitions: every setting covers at `rate`. */
const events = (rate: number): string => SETTINGS.map(() => Math.round(rate * 6000)).join(",");
const screen: Row[] = [
  {
    id: "G1/a/m0.050/margin",
    truth: "margin",
    reported: "false",
    reps: "6000",
    events: events(0.9445),
    structure: "",
  },
  {
    id: "G1/b/m0.050/margin",
    truth: "margin",
    reported: "false",
    reps: "6000",
    events: events(0.99),
    structure: "",
  },
  {
    id: "G2/top-nu2/k12-r2/m0.050/s100",
    truth: "margin",
    reported: "false",
    reps: "6000",
    events: events(0.93),
    structure: "[[0.95,0.9]]",
  },
  {
    id: "G1/a/m0.050/zero",
    truth: "zero",
    reported: "false",
    reps: "6000",
    events: events(0.2),
    structure: "",
  },
];
const listOf = (points: unknown): string => `${JSON.stringify({ points }, null, 1)}\n`;
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
const rowsFor = (ids: readonly string[]): Row[] =>
  ids.map((id) => ({ id, reps: "190000", events: "" }));

describe("stage 1's confirmation is bound to the screen", () => {
  const expected = confirmSelection(screen);
  const text = listOf(expected);
  const ids = expected.map((p) => p.id);

  it("selects the candidates at truth −margin and keeps their stored structures", () => {
    expect(ids).toContain("G1/a/m0.050/margin");
    expect(ids).toContain("G2/top-nu2/k12-r2/m0.050/s100");
    expect(ids).not.toContain("G1/a/m0.050/zero");
    expect(expected.find((p) => p.id.startsWith("G2"))?.structure).toBe("[[0.95,0.9]]");
  });

  it("accepts the list the screen determines, run by every shard", () => {
    expect(confirmBindingProblems(screen, text, rowsFor(ids), [sha(text), sha(text)])).toEqual([]);
  });

  it("refuses a stale list that leaves a candidate unconfirmed", () => {
    const stale = listOf(expected.filter((p) => p.id !== "G1/a/m0.050/margin"));
    const problems = confirmBindingProblems(
      screen,
      stale,
      rowsFor(ids.filter((id) => id !== "G1/a/m0.050/margin")),
      [sha(stale)],
    );
    expect(problems.some((p) => p.includes("differs from the list"))).toBe(true);
    expect(problems).toContain("G1/a/m0.050/margin: selected but not confirmed");
  });

  it("refuses a shard that ran another list, or recorded none", () => {
    const problems = confirmBindingProblems(screen, text, rowsFor(ids), [
      "0".repeat(64),
      undefined,
    ]);
    expect(problems.filter((p) => p.includes("ran a different list"))).toHaveLength(2);
  });

  it("refuses a repeated or an extra confirmed point", () => {
    const problems = confirmBindingProblems(
      screen,
      text,
      [...rowsFor(ids), ...rowsFor([ids[0] as string, "G1/x/m0.050/margin"])],
      [sha(text)],
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        `${ids[0]}: confirmed more than once`,
        "G1/x/m0.050/margin: confirmed but not selected",
      ]),
    );
  });
});
