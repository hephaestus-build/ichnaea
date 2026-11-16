import { describe, expect, it } from "vitest";

import { calibrationRule } from "../../scripts/stats/calibration-rule.ts";
import {
  CELLS,
  MARGINS,
  drawStudy,
  runCell,
  type CalibrationRule,
} from "../../scripts/stats/calibration-rule-study.ts";
import { COLUMNS, row, seedOf } from "../../scripts/stats/study-calibration-rule.ts";
import { createRng } from "../../src/stats/index.ts";

// A smoke run: 50 studies per cell and 200 resamples per study. The published study runs 2,000 and
// 2,000 (VALIDATION.md, "The judge calibration rule").
const STUDIES = 50;
const rule = calibrationRule({ tolerance: 0.15, resamples: 200 });
// A stub rule that always passes, with a fixed bound, to show that the study tabulates what it is given.
const always: CalibrationRule = () => ({
  agreementPass: true,
  shownBound: 0.12,
  armBias: 0,
  nanReplicates: 0,
  replicates: 1,
});
const smoke = new Map(
  CELLS.map((cell, i) => [cell.id, () => runCell(cell, rule, createRng(seedOf(i)), STUDIES)]),
);

describe("the judge calibration rule study, smoke run", () => {
  it.each(CELLS.map((cell, i) => [cell.id, i] as const))(
    "%s gives rates in [0, 1], the same on a rerun, and a row with every column",
    (id, i) => {
      const result = smoke.get(id)!();
      expect(result).toEqual(runCell(CELLS[i]!, rule, createRng(seedOf(i)), STUDIES));
      for (const rate of [result.agreementPass, ...result.withinMargin]) {
        expect(rate).toBeGreaterThanOrEqual(0);
        expect(rate).toBeLessThanOrEqual(1);
      }
      expect(result.nanShare).toBeGreaterThanOrEqual(0);
      expect(row(result, 200).split("\t")).toHaveLength(COLUMNS.length);
    },
  );

  it("passes a judge as good as a rater far more often than a clearly worse one", () => {
    expect(smoke.get("binary-equal")!().agreementPass).toBeGreaterThan(
      smoke.get("binary-worse")!().agreementPass + 0.4,
    );
    expect(smoke.get("levels-equal")!().agreementPass).toBeGreaterThan(
      smoke.get("levels-much-noisier")!().agreementPass + 0.5,
    );
  });

  it("sees the bias between the two configurations in its direction and size", () => {
    expect(Math.abs(smoke.get("binary-equal")!().meanArmBias)).toBeLessThan(0.03);
    expect(smoke.get("binary-bias-0.15")!().meanArmBias).toBeLessThan(-0.12);
    expect(smoke.get("levels-shift-0.50")!().meanArmBias).toBeGreaterThan(0.08);
  });
});

describe("the rule is a parameter of the study", () => {
  it("tabulates whatever rule it is given", () => {
    const result = runCell(CELLS[0]!, always, createRng(1), 10);
    expect(result.agreementPass).toBe(1);
    expect(result.withinMargin).toEqual(MARGINS.map((m) => (0.12 <= m ? 1 : 0)));
  });

  it("passes a judge that copies the raters, with no bias", () => {
    const study = drawStudy(CELLS[0]!, createRng(7));
    const copy = { ...study, second: study.first, judge: study.first };
    const outcome = rule(copy, createRng(8));
    expect(outcome.agreementPass).toBe(true);
    expect(outcome.shownBound).toBe(0);
    expect(outcome.armBias).toBe(0);
  });
});
