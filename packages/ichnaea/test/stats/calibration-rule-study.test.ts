import { describe, expect, it } from "vitest";

import { CONDITIONS, calibrationRule, weightedAc1 } from "../../scripts/stats/calibration-rule.ts";
import {
  CELLS,
  MARGINS,
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
  );

  it("passes a judge as good as a rater far more often than a clearly worse one", () => {
    expect(smoke("binary-equal-oversampled-n150").pass).toBeGreaterThan(
      smoke("binary-worse-oversampled-n150").pass + 0.4,
    );
    expect(smoke("levels-equal").pass).toBeGreaterThan(smoke("levels-much-noisier").pass + 0.5);
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
    expect(smoke("levels-equal").pass).toBe(holds("levels-equal", "alphaOrdinal"));
  });

  it("sees the bias between the two configurations in its direction and size", () => {
    expect(Math.abs(smoke("binary-equal").meanArmBias)).toBeLessThan(0.03);
    expect(smoke("binary-bias-0.15").meanArmBias).toBeLessThan(-0.12);
    expect(smoke("levels-shift-0.50").meanArmBias).toBeGreaterThan(0.08);
  });
});

describe("the calibration draw cells", () => {
  it("weights every drawn answer by 1/π ≥ 1, clusters by item and names the item strata", () => {
    const cell = CELLS.find((c) => c.id === "draw-with-c3-140-cap2-rho0.3-equal")!;
    const study = drawStudy(cell, createRng(11));
    expect(study.caseOf).toHaveLength(140);
    expect(study.weight.every((w) => w >= 1)).toBe(true);
    expect(new Set(study.stratumOf)).toEqual(new Set([0, 1]));
  });

  it("passes the good judge more often than the clearly worse one on the chatbot's draw", () => {
    expect(smoke("draw-with-c3-260-cap2-rho0-equal").pass).toBeGreaterThan(
      smoke("draw-with-c3-260-cap2-rho0-worse").pass + 0.2,
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

  it("passes a judge that copies the raters, with no bias", () => {
    const study = drawStudy(CELLS[0]!, createRng(7));
    const copy = { ...study, second: study.first, judge: study.first };
    const outcome = rule.evaluate(copy, createRng(8));
    expect(outcome.pass).toBe(true);
    expect(outcome.conditions).toMatchObject({ sensitivity: true, specificity: true, ac1: true });
    expect(outcome.shownBound).toBe(0);
    expect(outcome.armBias).toBe(0);
  });
});
