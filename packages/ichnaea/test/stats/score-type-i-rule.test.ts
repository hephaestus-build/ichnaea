// The decision logic of the score type-I study (scripts/stats/score-type-i-rule.ts and `judge` in
// scripts/stats/collect-score-type-i.ts), on small synthetic outputs. Each test fails if its rule is
// loosened: a level dropped, a bar moved, the worst-10 taken over reported points, a must-fail that
// passes accepted, the pooled check made two-sided or wider, or k1 taken from the wrong end.
import { describe, expect, it } from "vitest";

import { judge, recheckSelection, type Row } from "../../scripts/stats/collect-score-type-i.ts";
import {
  confirmationDone,
  failingLevels,
  k1Of,
  LEVELS,
  minConfirmReps,
  needsConfirmation,
  pairedDifference,
  pooledCheck,
  se,
} from "../../scripts/stats/score-type-i-rule.ts";

const R1 = [12, 17, 20, 30, 60, 100, 146, 200, 300];

/** The smallest count at n repetitions whose estimate is above level − 2·SE, found by search. */
function trigger(level: number, n: number): number {
  for (let h = 0; h <= n; h++)
    if (h / n + 2 * Math.sqrt(((h / n) * (1 - h / n)) / n) > level) return h;
  return n;
}

/** A screen row whose stage and flag follow from its counts, as the runner writes them. */
function screenRow(
  id: string,
  screenHits: readonly number[],
  options: {
    role?: string;
    generator?: string;
    test?: string;
    k?: number;
    pattern?: string;
    family?: string;
    confirmed?: { hits: readonly number[]; reps: number };
  } = {},
): Row {
  const confirmed = needsConfirmation(screenHits, 6_000);
  const final = confirmed
    ? (options.confirmed ?? { hits: screenHits.map((h) => h * 32), reps: 192_000 })
    : { hits: screenHits, reps: 6_000 };
  return {
    id,
    generator: options.generator ?? "1",
    family: options.family ?? "f",
    role: options.role ?? "type-I",
    k: String(options.k ?? 12),
    pattern: options.pattern ?? "r2",
    test: options.test ?? "permutation",
    seed: "1",
    screen_hits: screenHits.join(","),
    screen_reps: "6000",
    stage: confirmed ? "confirmed" : "screen",
    hits: final.hits.join(","),
    reps: String(final.reps),
    fails: String(confirmed && failingLevels(final.hits, final.reps).length > 0),
    structure: "",
    measure_hits: "",
  };
}

/** A healthy study: type-I points well below every level, and a must-fail that fails. */
const clean = (): Row[] => [
  screenRow("G1/a", [180, 90, 60, 45]),
  screenRow("G1/b", [200, 100, 66, 50]),
  ...R1.map((k) => screenRow(`G1/r1-${k}`, [180, 90, 60, 45], { k, pattern: "r1" })),
  screenRow("G8/must", [600, 300, 200, 150], {
    role: "must-fail",
    generator: "8",
    test: "wald",
    confirmed: { hits: [40_000, 20_000, 13_333, 10_000], reps: 400_000 },
  }),
];

/** A re-check row with discordant counts at 0.05 only. */
const recheck = (id: string, n10: number, n01: number, exact: number): Row => ({
  id,
  seed: "1",
  reps: "20000",
  exact: String(exact),
  shipped_hits: "900,450,300,225",
  study_hits: "900,450,300,225",
  n10: `${n10},0,0,0`,
  n01: `${n01},0,0,0`,
  fails: "false",
});

/** The paired z of n10 discordant repetitions against none, at 20,000. */
function pairedZ(n10: number): number {
  const p = pairedDifference(n10, 0, 20_000);
  return p.mean / Math.sqrt(p.variance);
}

describe("the type-I rule at each level", () => {
  it("confirms a point at each level's boundary, and not one count below it", () => {
    const n = 6_000;
    LEVELS.forEach((level, l) => {
      const h = trigger(level, n);
      // Rejections nest: a point that rejects at a smaller level rejects at the larger ones.
      const at = (x: number): number[] => LEVELS.map((_lv, i) => (i <= l ? x : 0));
      expect(needsConfirmation(at(h), n)).toBe(true);
      expect(needsConfirmation(at(h - 1), n)).toBe(false);
    });
  });

  it("fails a confirmed point at a level where estimate − 3·SE is above it, and only there", () => {
    const n = 200_000;
    // 0.0145 at the two smallest levels: above 0.0125 by more than 3 SE, below 0.05/3.
    const hits = [9_000, 4_400, 2_900, 2_900];
    expect(failingLevels(hits, n)).toEqual([0.0125]);
    const p = 2_900 / n;
    expect(p - 3 * se(p, n)).toBeGreaterThan(0.0125);
  });

  it("puts the fail bar at exactly 3 SE: 3.4 SE above a level fails, 2.4 SE does not", () => {
    const n = 200_000;
    const z = (h: number): number => (h / n - 0.0125) / se(h / n, n);
    // Fixtures between the bars, so a bar of 4 SE or of 2 SE changes a verdict.
    expect(z(2_674)).toBeGreaterThan(3.3);
    expect(z(2_674)).toBeLessThan(3.5);
    expect(z(2_624)).toBeGreaterThan(2.4);
    expect(z(2_624)).toBeLessThan(2.5);
    expect(failingLevels([9_000, 4_400, 2_674, 2_674], n)).toEqual([0.0125]);
    expect(failingLevels([9_000, 4_400, 2_624, 2_624], n)).toEqual([]);
  });

  it("stops a confirmation only at the minimum repetitions and SE ≤ 0.0005 at every level", () => {
    const min = minConfirmReps(0.0005);
    expect(min).toBeGreaterThanOrEqual(190_000);
    expect(confirmationDone([0, 0, 0, 0], min - 1, 0.0005)).toBe(false);
    expect(confirmationDone([0, 0, 0, 0], min, 0.0005)).toBe(true);
    // An estimate of 0.1 at 0.05 needs SE √(0.09/n) ≤ 0.0005, that is n ≥ 360,000.
    expect(confirmationDone([0.1 * min, 0, 0, 0], min, 0.0005)).toBe(false);
    expect(confirmationDone([36_000, 0, 0, 0], 360_000, 0.0005)).toBe(true);
  });
});

describe("the re-check selection", () => {
  it("takes the 10 worst type-I points of each generator, and the reported points' 10 worst apart", () => {
    const rows = [
      // Reported points rank above every type-I point.
      ...Array.from({ length: 12 }, (_, i) =>
        screenRow(`G2/rep${String(i).padStart(2, "0")}`, [200 + i, 100, 66, 50], {
          generator: "2",
          role: "reported",
        }),
      ),
      ...Array.from({ length: 12 }, (_, i) =>
        screenRow(`G2/typ${String(i).padStart(2, "0")}`, [100 + i, 50, 33, 25], { generator: "2" }),
      ),
    ];
    const ids = recheckSelection(rows).map((p) => p.id);
    expect(ids.filter((id) => id.includes("typ"))).toEqual(
      Array.from({ length: 10 }, (_, i) => `G2/typ${String(i + 2).padStart(2, "0")}`),
    );
    expect(ids.filter((id) => id.includes("rep"))).toHaveLength(10);
  });

  it("ranks by the largest estimate/level, so a point bad only at 0.0125 is among the worst", () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => screenRow(`G1/p${i}`, [150, 70, 40, 30])),
      // At 0.05 the lowest, at 0.0125 the highest: 55/6000, 0.73 of the level, and not confirmed.
      screenRow("G1/low", [70, 65, 62, 55]),
    ];
    expect(recheckSelection(rows).map((p) => p.id)).toContain("G1/low");
  });
});

describe("the verdict", () => {
  it("passes a healthy study", () => {
    const j = judge(clean(), [], false);
    expect(j.harness).toEqual([]);
    expect(j.passes).toBe(true);
    expect(j.oneTrialK1).toBe(12);
  });

  it("fails a type-I point that fails only at 0.0125", () => {
    const rows = [
      ...clean(),
      screenRow("G1/holm", [270, 135, 95, 90], {
        confirmed: { hits: [9_000, 4_400, 2_900, 2_900], reps: 200_000 },
      }),
    ];
    const j = judge(rows, [], false);
    expect(j.passes).toBe(false);
    expect(j.failures.some((f) => f.startsWith("G1/holm"))).toBe(true);
  });

  it("fails when a must-fail does not fail, and when the harness never rejects", () => {
    const rows = clean().map((r) =>
      r["role"] === "must-fail" ? screenRow("G8/must", [10, 5, 3, 2], { role: "must-fail" }) : r,
    );
    expect(judge(rows, [], false).harness).toContain("must-fail G8/must did not fail");
    const never = clean().map((r) =>
      screenRow(r["id"] as string, [0, 0, 0, 0], {
        role: r["role"] as string,
        k: Number(r["k"]),
        pattern: r["pattern"] as string,
      }),
    );
    const j = judge(never, [], false);
    expect(j.passes).toBe(false);
    expect(j.mustFail.every((m) => !m.failed)).toBe(true);
  });

  it("applies the rule again and flags a stage or flag that the counts do not give", () => {
    const rows = clean();
    (rows[0] as Row)["stage"] = "confirmed";
    const other = clean();
    (other[1] as Row)["fails"] = "true";
    expect(judge(rows, [], false).harness.some((h) => h.startsWith("G1/a: stage"))).toBe(true);
    expect(judge(other, [], false).harness.some((h) => h.startsWith("G1/b: fails"))).toBe(true);
  });

  it("never passes a smoke run", () => {
    expect(judge(clean(), [], true).passes).toBe(false);
  });

  it("pools paired differences one-sided, per level and per path", () => {
    // Paired SE from the discordant counts: n10 = 30, n01 = 10 at 20,000.
    const d = pairedDifference(30, 10, 20_000);
    expect(d.mean).toBe(0.001);
    expect(d.variance).toBeCloseTo((40 - 400 / 20_000) / 20_000 ** 2, 18);
    const up = pooledCheck([d, d, d, d]);
    expect(up.pooledSe).toBeCloseTo(Math.sqrt(4 * d.variance) / 4, 15);
    expect(up.passes).toBe(d.mean <= 3 * up.pooledSe);
    // The bar is exactly 3 pooled SE: 3.5 SE above 0 fails, 2.4 SE passes, so a bar of 4 SE or of
    // 2 SE changes a verdict. With n01 = 0 the paired z is n10/√(n10 − n10²/n).
    expect(pairedZ(12)).toBeGreaterThan(3.4);
    expect(pairedZ(12)).toBeLessThan(3.5);
    expect(pairedZ(6)).toBeGreaterThan(2.4);
    expect(pairedZ(6)).toBeLessThan(2.5);
    expect(pooledCheck([pairedDifference(12, 0, 20_000)]).passes).toBe(false);
    expect(pooledCheck([pairedDifference(6, 0, 20_000)]).passes).toBe(true);
    expect(judge(clean(), [recheck("G1/a", 12, 0, 0)], false).passes).toBe(false);
    expect(judge(clean(), [recheck("G1/a", 6, 0, 0)], false).passes).toBe(true);
    // A negative mean, the shipped test more conservative, passes however large.
    expect(pooledCheck([pairedDifference(0, 400, 20_000)]).passes).toBe(true);
    expect(pooledCheck([pairedDifference(400, 0, 20_000)]).passes).toBe(false);

    const liberal = judge(clean(), [recheck("G1/a", 400, 0, 0)], false);
    expect(liberal.passes).toBe(false);
    const failing = liberal.pooled.filter((p) => !p.passes);
    expect(failing.map((p) => [p.pool, p.level])).toEqual([["monte-carlo", 0.05]]);
    const conservative = judge(clean(), [recheck("G1/a", 0, 400, 20_000)], false);
    expect(conservative.passes).toBe(true);
    expect(
      conservative.pooled.find((p) => p.pool === "lattice" && p.level === 0.05)?.meanDifference,
    ).toBe(-0.02);
    // A reported point's re-check stays out of the pools.
    const reported = [...clean(), screenRow("G2/rep", [180, 90, 60, 45], { role: "reported" })];
    const r = judge(reported, [recheck("G2/rep", 400, 0, 0)], false);
    expect(r.pooled.every((p) => p.points === 0)).toBe(true);
    expect(r.reportedRechecks.map((c) => c.id)).toEqual(["G2/rep"]);
  });

  it("fails a point whose shipped re-check fails at a level", () => {
    const rows = clean();
    const j = judge(
      rows,
      [
        {
          id: "G1/a",
          seed: "1",
          reps: "20000",
          exact: "0",
          shipped_hits: "900,450,400,400",
          study_hits: "900,450,300,225",
          n10: "0,0,100,175",
          n01: "0,0,0,0",
          fails: "true",
        },
      ],
      false,
    );
    expect(j.failures).toContain("G1/a: 0.0300, 0.0150, 0.0100, 0.0075 (shipped test)");
  });
});

describe("k1 at one trial per case", () => {
  it("is the smallest swept k from which every larger k passes", () => {
    expect(k1Of(R1, () => false)).toBe(12);
    expect(k1Of(R1, (k) => k === 12)).toBe(17);
    expect(k1Of(R1, (k) => k === 200)).toBe(300);
    expect(k1Of(R1, (k) => k === 300)).toBe(null);
  });

  it("rises when a larger k fails in the verdict", () => {
    const rows = clean().map((r) =>
      r["id"] === "G1/r1-200"
        ? screenRow("G1/r1-200", [400, 200, 133, 100], {
            k: 200,
            pattern: "r1",
            confirmed: { hits: [13_750, 6_250, 4_125, 3_125], reps: 250_000 },
          })
        : r,
    );
    expect(judge(rows, [], false).oneTrialK1).toBe(300);
  });
});
