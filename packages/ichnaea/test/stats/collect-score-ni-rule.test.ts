// The rule of stage 1 of the score non-inferiority study (scripts/stats/collect-score-ni.ts and
// scripts/stats/study-score-ni.ts), on synthetic rows: each named must-fail check holds only with a
// confirmed failure on its own family; S-C is never selectable; reported points are never confirmed
// and decide nothing; and a confirmation stops when every selectable setting's standard error is
// within 0.0005, or at the 1,000,000 cap, which the collector accepts only on a row marked capped.
import { describe, expect, it } from "vitest";

import {
  choose,
  CONFIRM_CAP,
  confirmSelection,
  confirmSeProblems,
  harnessPasses,
  MUST_FAIL_CHECKS,
  mustFailResults,
  WORST_PER_MUST_FAIL,
} from "../../scripts/stats/collect-score-ni.ts";
import type { Row } from "../../scripts/stats/collect-score-type-i.ts";
import { SETTINGS } from "../../scripts/stats/score-ni-points.ts";
import { confirmUntil, selectableSeWithin } from "../../scripts/stats/study-score-ni.ts";

/** Event counts over `reps` repetitions: every setting covers at `rate`, except those in `by`. */
const events = (reps: number, rate: number, by: Record<string, number> = {}): string =>
  SETTINGS.map((s) => Math.round((by[s.name] ?? rate) * reps)).join(",");
const row = (
  id: string,
  generator: string,
  family: string,
  rates: Record<string, number> = {},
  extra: Partial<Row> = {},
): Row => ({
  id,
  generator,
  family,
  truth: "margin",
  reported: "false",
  reps: "6000",
  events: events(6000, 0.99, rates),
  structure: "",
  ...extra,
});
const confirmedRow = (id: string, rates: Record<string, number>, reps = 250_000): Row => ({
  id,
  reps: String(reps),
  events: events(reps, 0.99, rates),
  capped: "false",
});

/** A screen where every named must-fail check has a point of its family. */
const screen: Row[] = [
  row("G3/nuC2-nuB50/k12-r2/m0.050/margin", "3", "nuC2-nuB50"),
  row("G2/top-nu2/k12-r2/m0.050/s1", "2", "top-nu2"),
  row("G2/floor-nu2/k12-r2/m0.050/s1", "2", "floor-nu2"),
  row("G2/concentrated/k12-r2/m0.050/s1", "2", "concentrated"),
  row("G1/nu10/k12-r2/m0.050/margin", "1", "nu10"),
];
const failing = { "S-C": 0.8, "S-B phi_min 0": 0.8 };
const confirmAll = (
  rates: Record<string, number>,
  ids = screen.map((r) => r["id"] as string),
): Map<string, Row> => new Map(ids.map((id) => [id, confirmedRow(id, rates)]));

/** A setting's result as the choice reads it. */
const result = (name: string, pi0: number, eligible = true) => ({
  name,
  role: SETTINGS.find((s) => s.name === name)?.role as string,
  failures: eligible ? [] : ["x"],
  gridMeanPasses: true,
  medianPi0AtMargin010: pi0,
});

/** A block runner whose selectable settings cover at `rate` and whose others cover at 0.5. */
const blocks =
  (rate: number) =>
  (counts: number[], _done: number, n: number): void =>
    SETTINGS.forEach((s, i) => {
      counts[i] = (counts[i] as number) + Math.round((s.role === "candidate" ? rate : 0.5) * n);
    });

/** A confirmation row whose selectable settings cover at `rate`, the controls at 0.5. */
const confirmation = (rate: number, reps: number, capped: boolean): Row => ({
  id: `p${rate}-${reps}`,
  reps: String(reps),
  events: events(reps, rate, { "S-B phi_min 0": 0.5, "S-C": 0.5 }),
  capped: String(capped),
});

describe("score non-inferiority: the named must-fail checks", () => {
  it("holds when each setting fails, confirmed, on the family it is named for", () => {
    const results = mustFailResults(screen, confirmAll(failing));
    expect(results.map((m) => [m.setting, m.family, m.failed])).toEqual(
      MUST_FAIL_CHECKS.map((c) => [c.setting, c.family, true]),
    );
    expect(harnessPasses(results)).toBe(true);
  });

  it("fails the harness when a check never fails: a harness that never rejects is caught", () => {
    expect(harnessPasses(mustFailResults(screen, confirmAll({})))).toBe(false);
  });

  it("does not count a failure on another family", () => {
    // S-C fails only on G1 and on G2 floor: neither is G3 nor G2 top.
    const confirmed = confirmAll({ "S-B phi_min 0": 0.8 });
    for (const id of ["G1/nu10/k12-r2/m0.050/margin", "G2/floor-nu2/k12-r2/m0.050/s1"])
      confirmed.set(id, confirmedRow(id, failing));
    const results = mustFailResults(screen, confirmed);
    expect(results.filter((m) => m.setting === "S-C").map((m) => m.failed)).toEqual([false, false]);
    expect(harnessPasses(results)).toBe(false);
  });

  it("does not count a failure that was only screened, or a failure at truth 0", () => {
    const screenedOnly = screen.map((r) => ({ ...r, events: events(6000, 0.99, failing) }));
    expect(harnessPasses(mustFailResults(screenedOnly, new Map()))).toBe(false);
    const atZero = screen.map((r) => ({ ...r, truth: "zero" }));
    expect(harnessPasses(mustFailResults(atZero, confirmAll(failing)))).toBe(false);
  });

  it("reports S-B with φ_min = 0 on the concentrated family apart: it decides nothing", () => {
    const confirmed = confirmAll(failing);
    const id = "G2/concentrated/k12-r2/m0.050/s1";
    confirmed.set(id, confirmedRow(id, {}));
    const results = mustFailResults(screen, confirmed);
    expect(results.find((m) => m.family === "G2 concentrated")).toMatchObject({
      reported: true,
      failed: false,
    });
    expect(harnessPasses(results)).toBe(true);
  });
});

describe("score non-inferiority: the confirmation list", () => {
  it("confirms the worst points of each must-fail check on its family, and never a reported point", () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      row(`G2/top-nu2/k12-r2/m0.050/s${i}`, "2", "top-nu2", {
        "S-C": 0.95 - i / 1000,
        // The same order for the other check on G2 top, so both confirm the same 10 points.
        "S-B phi_min 0": 0.95 - i / 1000,
      }),
    );
    const reported = row(
      "G4/sigma0.1-separate/k12-r2/m0.050/margin",
      "4",
      "sigma0.1-separate",
      { "S-A": 0.5 },
      { reported: "true" },
    );
    const ids = confirmSelection([...many, reported]).map((p) => p.id);
    // The 10 lowest S-C coverages on G2 top: s5 to s14.
    for (let i = 5; i < 15; i++) expect(ids).toContain(`G2/top-nu2/k12-r2/m0.050/s${i}`);
    expect(ids.filter((id) => id.startsWith("G2/top")).length).toBe(WORST_PER_MUST_FAIL);
    expect(ids).not.toContain(reported["id"]);
  });

  it("never selects on S-C or S-B with φ_min = 0 alone: they are not selectable", () => {
    const g1 = row("G1/nu10/k12-r2/m0.050/margin", "1", "nu10", failing);
    expect(confirmSelection([g1]).map((p) => p.id)).toEqual([]);
    const sa = row("G1/nu10/k17-r2/m0.050/margin", "1", "nu10", { "S-A": 0.93 });
    expect(confirmSelection([sa]).map((p) => p.id)).toEqual([sa["id"]]);
  });
});

describe("score non-inferiority: the choice", () => {
  it("never chooses S-C, even with the highest π₀ and no failure", () => {
    const { eligible, chosen } = choose([result("S-C", 0.99), result("S-A", 0.5)]);
    expect(eligible.map((r) => r.name)).toEqual(["S-A"]);
    expect(chosen?.name).toBe("S-A");
  });

  it("takes S-A when no S-B setting is eligible, and S-A first on a tie", () => {
    expect(choose([result("S-A", 0.5), result("S-B phi_min 0.1", 0.9, false)]).chosen?.name).toBe(
      "S-A",
    );
    expect(choose([result("S-B phi_min 0.05", 0.5), result("S-A", 0.5)]).chosen?.name).toBe("S-A");
    expect(
      choose([result("S-B phi_min 0.01", 0.5), result("S-B phi_min 0.1", 0.5)]).chosen?.name,
    ).toBe("S-B phi_min 0.1");
  });

  it("chooses nothing when nothing selectable is eligible", () => {
    expect(
      choose([result("S-A", 0.5, false), result("S-B phi_min 0", 0.9)]).chosen,
    ).toBeUndefined();
  });
});

describe("score non-inferiority: confirmation to SE 0.0005, capped at 1,000,000", () => {
  it("stops at the first block where every selectable setting's SE is within 0.0005", () => {
    // At 0.94, SE ≤ 0.0005 needs 225,600 repetitions: 5 blocks of 50,000.
    const run = confirmUntil(blocks(0.94), 50_000, CONFIRM_CAP, 0.0005);
    expect(run).toMatchObject({ reps: 250_000, capped: false });
    expect(selectableSeWithin(run.counts, 200_000, 0.0005)).toBe(false);
    // At coverage 1 the SE is 0 after one block. The controls at 0.5 never drive the stop.
    expect(confirmUntil(blocks(1), 50_000, CONFIRM_CAP, 0.0005)).toMatchObject({
      reps: 50_000,
      capped: false,
    });
  });

  it("stops at the cap and marks the point capped", () => {
    // At 0.45, SE ≤ 0.0005 needs 990,000 repetitions: the 20th block reaches the cap.
    expect(confirmUntil(blocks(0.45), 50_000, CONFIRM_CAP, 0.0005)).toMatchObject({
      reps: CONFIRM_CAP,
      capped: true,
    });
    // A smaller cap stops the loop where the SE is still above the target.
    const short = confirmUntil(blocks(0.45), 50_000, 200_000, 0.0005);
    expect(short).toMatchObject({ reps: 200_000, capped: true });
    expect(selectableSeWithin(short.counts, short.reps, 0.0005)).toBe(false);
  });

  it("accepts an SE above 0.0005 only on a capped row, and lists it for review", () => {
    expect(
      confirmSeProblems(
        [confirmation(0.94, 250_000, false), confirmation(0.45, CONFIRM_CAP, true)],
        false,
      ),
    ).toEqual({ problems: [], capped: ["p0.45-1000000"] });
    expect(confirmSeProblems([confirmation(0.94, 200_000, false)], false).problems).toEqual([
      "p0.94-200000: SE above 0.0005 for S-A, S-B phi_min 0.01, S-B phi_min 0.02, S-B phi_min 0.05, S-B phi_min 0.1 and not capped",
    ]);
    expect(confirmSeProblems([confirmation(0.45, 500_000, true)], false).problems).toEqual([
      "p0.45-500000: capped at 500000 repetitions, not 1000000",
    ]);
    expect(confirmSeProblems([confirmation(0.94, 210_000, false)], false).problems[0]).toContain(
      "not whole blocks",
    );
  });
});
