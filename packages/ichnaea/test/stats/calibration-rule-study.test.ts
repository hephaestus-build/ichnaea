import { describe, expect, it } from "vitest";

import {
  ARM_BIAS_MARGIN,
  CONDITIONS,
  calibrationRule,
  weightedAc1,
} from "../../scripts/stats/calibration-rule.ts";
import {
  CELLS,
  CHATBOT,
  MARGINS,
  designOf,
  drawStudy,
  runCell,
  type CalibrationRule,
} from "../../scripts/stats/calibration-rule-study.ts";
import { COLUMNS, row, seedOf } from "../../scripts/stats/study-calibration-rule.ts";
import { createRng, gwetAc1 } from "../../src/stats/index.ts";

// A smoke run: 50 studies per cell and 200 resamples per study. The published study runs 2,000 and
// 2,000 (VALIDATION.md, "The judge calibration rule").
const STUDIES = 50;
const rule = calibrationRule({ agreementTolerance: 0.15, rateTolerance: 0.1, resamples: 200 });
// A stub rule that always passes, with a fixed bound, to show that the study tabulates what it is given.
const always: CalibrationRule = {
  conditions: ["only"],
  evaluate: () => ({
    pass: true,
    conditions: { only: true },
    shownBound: 0.12,
    armBias: 0,
    nanReplicates: 0,
    replicates: 1,
  }),
};
const results = new Map<string, ReturnType<typeof runCell>>();
const smoke = (id: string): ReturnType<typeof runCell> => {
  const index = CELLS.findIndex((cell) => cell.id === id);
  if (!results.has(id))
    results.set(id, runCell(CELLS[index]!, rule, createRng(seedOf(index)), STUDIES));
  return results.get(id)!;
};
const holds = (id: string, condition: (typeof CONDITIONS)[number]): number =>
  smoke(id).conditions[CONDITIONS.indexOf(condition)]!;

describe("the judge calibration rule study, smoke run", () => {
  it.each(CELLS.map((cell, i) => [cell.id, i] as const))(
    "%s gives rates in [0, 1], the same on a rerun, and a row with every column",
    (id, i) => {
      const result = smoke(id);
      expect(result).toEqual(runCell(CELLS[i]!, rule, createRng(seedOf(i)), STUDIES));
      for (const rate of [result.pass, ...result.withinMargin]) {
        expect(rate).toBeGreaterThanOrEqual(0);
        expect(rate).toBeLessThanOrEqual(1);
      }
      expect(result.nanShare).toBeGreaterThanOrEqual(0);
      expect(row(result, 200).split("\t")).toHaveLength(COLUMNS.length);
    },
    // A draw cell of several hundred answers runs its studies twice here, which takes longer than
    // the default 5 s on a shared runner.
    60_000,
  );

  it("holds a judge as good as a rater to its conditions far more often than a clearly worse one", () => {
    // The judge's own conditions: the pass also needs the rater floor, which depends on the raters.
    expect(holds("binary-equal", "ac1")).toBeGreaterThan(holds("binary-worse", "ac1") + 0.4);
    expect(holds("levels-equal", "alphaOrdinal")).toBeGreaterThan(
      holds("levels-much-noisier", "alphaOrdinal") + 0.5,
    );
  });

  it("refuses uninformative yes/no judges whose AC1 gap alone would pass at low prevalence", () => {
    for (const id of [
      "binary-always-no-rare",
      "binary-always-no-very-rare",
      "binary-chance-very-rare",
    ]) {
      expect(smoke(id).pass).toBe(0);
      expect(holds(id, "ac1")).toBeGreaterThan(0.8);
    }
    expect(smoke("binary-chance-oversampled").pass).toBe(0);
  });

  it("reports each scale's own conditions, and NA for the other's", () => {
    expect(holds("levels-equal", "sensitivity")).toBeNaN();
    expect(holds("binary-equal", "alphaOrdinal")).toBeNaN();
    // The pass needs the rater floor as well, so it is at most the alpha condition's rate.
    expect(smoke("levels-equal").pass).toBeLessThanOrEqual(holds("levels-equal", "alphaOrdinal"));
  });

  it("holds a judge to the bias gate between base and candidate", () => {
    expect(holds("binary-equal", "armBias")).toBeGreaterThan(holds("binary-bias-0.15", "armBias"));
    expect(holds("levels-equal", "armBias")).toBeGreaterThan(holds("levels-shift-0.50", "armBias"));
    expect(smoke("binary-bias-0.15").pass).toBeLessThanOrEqual(
      holds("binary-bias-0.15", "armBias"),
    );
  });

  it("sees the bias between the two configurations in its direction and size", () => {
    expect(Math.abs(smoke("binary-equal").meanArmBias)).toBeLessThan(0.03);
    expect(smoke("binary-bias-0.15").meanArmBias).toBeLessThan(-0.12);
    expect(smoke("levels-shift-0.50").meanArmBias).toBeGreaterThan(0.08);
  });
});

describe("the calibration draw cells", () => {
  it("weights every drawn answer by 1/π ≥ 1, clusters by item and names the item strata", () => {
    const cell = CELLS.find((c) => c.id === "draw-n140-good")!;
    const study = drawStudy(cell, createRng(11));
    expect(study.caseOf).toHaveLength(140);
    expect(study.weight.every((w) => w >= 1)).toBe(true);
    expect(new Set(study.stratumOf)).toEqual(new Set([0, 1]));
  });

  it("splits a draw by the registered allocation, as the 140-answer pilot does", () => {
    expect(designOf(140, CHATBOT).groups).toEqual([
      { configuration: 0, units: 41, positiveShare: 0.2 },
      { configuration: 1, units: 41, positiveShare: 0.2 },
      { configuration: 2, units: 58, positiveShare: 0.4 },
    ]);
  });

  it("passes the good judge more often than the clearly worse one on the chatbot's draw", () => {
    expect(smoke("draw-n360-rho0-good").pass).toBeGreaterThan(
      smoke("draw-n360-rho0-worse").pass + 0.2,
    );
  });
});

describe("the weighted statistics", () => {
  it("give ./stats' gwetAc1 when every weight is 1", () => {
    const study = drawStudy(CELLS[0]!, createRng(3));
    const answers = study.caseOf.map((_, i) => i);
    const table = [
      [0, 0],
      [0, 0],
    ];
    for (const i of answers) table[study.judge[i]!]![study.first[i]!]! += 1;
    expect(weightedAc1(study.judge, study.first, answers, study.weight)).toBeCloseTo(
      gwetAc1(table),
      12,
    );
  });
});

describe("the rule is a parameter of the study", () => {
  it("tabulates whatever rule it is given", () => {
    const result = runCell(CELLS[0]!, always, createRng(1), 10);
    expect(result.pass).toBe(1);
    expect(result.conditions).toEqual([1]);
    expect(result.withinMargin).toEqual(MARGINS.map((m) => (0.12 <= m ? 1 : 0)));
  });

  it.each([
    ["binary", 0, "binary"],
    ["levels", CELLS.findIndex((c) => c.id === "levels-equal"), "levels"],
  ] as const)("gates the %s bias at its margin, inclusive", (_scale, index, key) => {
    const study = drawStudy(CELLS[index]!, createRng(9));
    const at = (margin: number): boolean =>
      calibrationRule({
        agreementTolerance: 0.15,
        rateTolerance: 0.1,
        resamples: 200,
        armBiasMargin: { binary: 1, levels: 1, [key]: margin },
      }).evaluate(study, createRng(10)).conditions["armBias"]!;
    const bound = rule.evaluate(study, createRng(10)).shownBound;
    expect(bound).toBeGreaterThan(0);
    expect(at(bound)).toBe(true);
    expect(at(bound - 1e-9)).toBe(false);
  });

  it("uses the registered margins, 0.20 for yes/no and 0.15 for levels", () => {
    expect(ARM_BIAS_MARGIN).toEqual({ binary: 0.2, levels: 0.15 });
  });

  it("passes a judge that copies the raters, with no bias", () => {
    const study = drawStudy(CELLS[0]!, createRng(7));
    const copy = { ...study, second: study.first, judge: study.first };
    const outcome = rule.evaluate(copy, createRng(8));
    expect(outcome.pass).toBe(true);
    expect(outcome.conditions).toMatchObject({
      sensitivity: true,
      specificity: true,
      ac1: true,
      armBias: true,
    });
    expect(outcome.shownBound).toBe(0);
    expect(outcome.armBias).toBe(0);
  });
});
