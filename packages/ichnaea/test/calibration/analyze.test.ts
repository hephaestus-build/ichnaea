import { describe, expect, it } from "vitest";

import {
  analyzeCalibration,
  judgePass,
  type CalibrationUnit,
} from "../../src/calibration/index.ts";
import { createRng } from "../../src/stats/index.ts";

// Synthetic calibration sets for a campus help desk's answers. A label of 1 marks a defect.
type Configuration = CalibrationUnit["configuration"];

/** One unit per configuration for each item, labelled by `label(item, configuration, reader)`. */
function units(
  items: number,
  label: (item: number, configuration: Configuration, reader: 0 | 1 | 2) => number,
  {
    configurations = ["base", "candidate"] as readonly Configuration[],
    weight = (_item: number): number => 1,
    stratum = (_item: number): string => "all",
  } = {},
): CalibrationUnit[] {
  return Array.from({ length: items }, (_, item) =>
    configurations.map((configuration): CalibrationUnit => ({
      item: `item-${item}`,
      stratum: stratum(item),
      configuration,
      weight: weight(item),
      raters: [label(item, configuration, 0), label(item, configuration, 1)],
      judge: label(item, configuration, 2),
    })),
  ).flat();
}

/** Labels from a truth with prevalence `p`, each reader correct with its accuracy. */
function readers(
  seed: number,
  p: number,
  accuracy: readonly [number, number, number],
): (item: number, configuration: Configuration, reader: 0 | 1 | 2) => number {
  const rng = createRng(seed);
  const labels = new Map<string, number>();
  return (item, configuration, reader) => {
    const key = `${item}/${configuration}`;
    if (!labels.has(key)) {
      const truth = rng.uniform() < p ? 1 : 0;
      for (const r of [0, 1, 2] as const) {
        labels.set(`${key}/${r}`, rng.uniform() < accuracy[r] ? truth : 1 - truth);
      }
      labels.set(key, truth);
    }
    return labels.get(`${key}/${reader}`)!;
  };
}

const settings = { resamples: 400, seed: 1 };

describe("analyzeCalibration on yes/no labels", () => {
  it("calibrates a judge that reads like the raters, as a secondary measure", () => {
    const analysis = analyzeCalibration(
      { scale: "binary", units: units(150, readers(1, 0.35, [0.95, 0.95, 0.95])) },
      settings,
    );
    expect(analysis.statistic).toBe("gwet-ac1");
    expect(analysis.status).toBe("calibrated");
    expect(analysis.failed).toEqual([]);
    expect(analysis.use).toBe("secondary");
    expect(analysis.conditions.ratersFloor.holds).toBe(true);
    expect(analysis.conditions.agreement.lower).toBeLessThanOrEqual(analysis.difference.estimate);
  });

  it("is diagnostic with the rater floor failed when the raters agree too little", () => {
    const analysis = analyzeCalibration(
      { scale: "binary", units: units(150, readers(2, 0.35, [0.7, 0.7, 0.95])) },
      settings,
    );
    expect(analysis.status).toBe("diagnostic");
    expect(analysis.failed).toContain("ratersFloor");
    expect(analysis.conditions.ratersFloor.floor).toBe(0.6);
  });

  it("refuses a judge that always says no, whose agreement alone could pass at low prevalence", () => {
    const truth = readers(3, 0.05, [1, 1, 1]);
    const analysis = analyzeCalibration(
      {
        scale: "binary",
        units: units(200, (item, configuration, reader) =>
          reader === 2 ? 0 : truth(item, configuration, reader),
        ),
      },
      settings,
    );
    expect(analysis.status).toBe("diagnostic");
    expect(analysis.failed).toContain("sensitivity");
    expect(analysis.sensitivity!.judge).toBe(0);
  });

  it("weights every statistic by 1/π", () => {
    // Item 0 carries weight 9: its positive answers are rare in the population. The judge misses
    // item 0's positive and finds item 1's, so its weighted sensitivity is 1/(9 + 1).
    const labels = [
      { raters: [1, 1], judge: 0, weight: 9 },
      { raters: [1, 1], judge: 1, weight: 1 },
      { raters: [0, 0], judge: 0, weight: 1 },
      { raters: [0, 0], judge: 0, weight: 1 },
    ] as const;
    const analysis = analyzeCalibration(
      {
        scale: "binary",
        units: labels.flatMap((l, item) =>
          (["base", "candidate"] as const).map((configuration): CalibrationUnit => ({
            item: `item-${item}`,
            stratum: "all",
            configuration,
            weight: l.weight,
            raters: l.raters,
            judge: l.judge,
          })),
        ),
      },
      settings,
    );
    expect(analysis.sensitivity!.judge).toBeCloseTo(0.1, 12);
    expect(analysis.sensitivity!.humanHuman).toBe(1);
    // Kish's effective number of units: (Σw)² / Σw², with w = 9, 1, 1, 1 twice over.
    expect(analysis.effectiveUnits).toBeCloseTo(24 ** 2 / 168, 12);
  });

  it("gives the same analysis for the same seed", () => {
    const input = { scale: "binary", units: units(80, readers(4, 0.3, [0.9, 0.9, 0.85])) } as const;
    expect(analyzeCalibration(input, settings)).toEqual(analyzeCalibration(input, settings));
  });

  it("shows the bias between base and candidate with its sign", () => {
    // The judge misses every candidate defect: on [0, 1] the candidate reads better to the judge.
    const truth = readers(5, 0.3, [1, 1, 1]);
    const analysis = analyzeCalibration(
      {
        scale: "binary",
        units: units(120, (item, configuration, reader) =>
          reader === 2 && configuration === "candidate" ? 0 : truth(item, configuration, reader),
        ),
      },
      settings,
    );
    expect(analysis.armBias.estimate).toBeLessThan(-0.2);
    expect(analysis.armBias.shownBound).toBe(
      Math.max(Math.abs(analysis.armBias.lower90), Math.abs(analysis.armBias.upper90)),
    );
    // The bias is not ruled out, so the judge is not calibrated, even as a secondary measure.
    expect(analysis.status).toBe("diagnostic");
    expect(analysis.failed).toContain("armBias");
  });
});

describe("the bias gate between base and candidate", () => {
  const binary = { scale: "binary", units: units(60, readers(9, 0.3, [0.9, 0.9, 0.8])) } as const;
  const rng = createRng(10);
  const levels = {
    scale: "levels",
    levels: 5,
    units: units(60, (item, _configuration, reader) => {
      const quality = 1 + (item % 5);
      return reader === 2 && rng.uniform() < 0.3 ? Math.min(5, quality + 1) : quality;
    }),
  } as const;

  it.each([
    ["yes/no", binary, 0.2, "binary"],
    ["levels", levels, 0.15, "levels"],
  ] as const)("holds at the %s margin and fails just inside it", (_name, input, margin, key) => {
    const at = (m: number): ReturnType<typeof analyzeCalibration> =>
      analyzeCalibration(input, { ...settings, armBiasMargin: { binary: 1, levels: 1, [key]: m } });
    expect(analyzeCalibration(input, settings).conditions.armBias.margin).toBe(margin);
    const bound = at(1).armBias.shownBound;
    expect(bound).toBeGreaterThan(0);
    expect(at(bound).conditions.armBias).toEqual({ holds: true, shownBound: bound, margin: bound });
    expect(at(bound).failed).not.toContain("armBias");
    expect(at(bound - 1e-9).failed).toContain("armBias");
    expect(at(bound - 1e-9).status).toBe("diagnostic");
  });

  it("leaves the known-worse answers out of the gate", () => {
    const truth = readers(11, 0.3, [1, 1, 1]);
    // The judge misses every known-worse defect: a large bias on that pair, none on base and candidate.
    const analysis = analyzeCalibration(
      {
        scale: "binary",
        units: units(
          80,
          (item, configuration, reader) =>
            reader === 2 && configuration === "known-worse"
              ? 0
              : truth(item, configuration, reader),
          { configurations: ["base", "candidate", "known-worse"] },
        ),
      },
      settings,
    );
    expect(analysis.armBias.shownBound).toBe(0);
    expect(analysis.conditions.armBias.holds).toBe(true);
    expect(analysis.slope!.pairBound).toBeGreaterThan(0.1);
  });
});

/** Base and candidate have a defect on every tenth item, known-worse on every other one. */
const pairTruth = (item: number, configuration: Configuration): number =>
  configuration === "known-worse" ? (item % 2 === 0 ? 1 : 0) : item % 10 === 0 ? 1 : 0;

describe("the slope on the base against known-worse pair", () => {
  const truth = pairTruth;
  const pairUnits = (
    judge: (item: number, configuration: Configuration) => number,
  ): CalibrationUnit[] =>
    units(
      100,
      (item, configuration, reader) =>
        reader === 2 ? judge(item, configuration) : truth(item, configuration),
      { configurations: ["base", "candidate", "known-worse"] },
    );

  it("is 1 for a judge that reads like the raters, and leaves a judge-based Pass reachable", () => {
    const analysis = analyzeCalibration({ scale: "binary", units: pairUnits(truth) }, settings);
    const slope = analysis.slope!;
    expect(slope.estimate).toBe(1);
    expect(slope.lower).toBe(1);
    expect(slope.humanChange).toBeCloseTo(-0.4, 12);
    expect(slope.dropShown).toBe(true);
    expect(slope.pairBound).toBe(0);
    expect(judgePass(analysis, 0.1)).toEqual({ reachable: true, lowerBoundAtLeast: -0.1 });
  });

  it("is about 1/2 for a judge that sees half of the drop, and caps no Pass it cannot reach", () => {
    // On known-worse the judge finds 30 defects where the raters find 50: its quality drops by 0.20
    // from base (0.90 to 0.70), the raters' by 0.40.
    const analysis = analyzeCalibration(
      {
        scale: "binary",
        units: pairUnits((item, configuration) =>
          configuration === "known-worse"
            ? item % 4 === 0 || item % 10 === 0
              ? 1
              : 0
            : truth(item, configuration),
        ),
      },
      settings,
    );
    expect(analysis.slope!.estimate).toBeCloseTo(0.5, 12);
    const pass = judgePass(analysis, 0.1);
    expect(pass.reachable).toBe(analysis.slope!.lower * 0.1 - analysis.slope!.pairBound > 0);
    expect(pass.lowerBoundAtLeast).toBeCloseTo(
      -(analysis.slope!.lower * 0.1 - analysis.slope!.pairBound),
      12,
    );
  });

  it("is absent without known-worse answers", () => {
    const analysis = analyzeCalibration(
      { scale: "binary", units: units(40, readers(6, 0.3, [0.9, 0.9, 0.9])) },
      settings,
    );
    expect(analysis.slope).toBeUndefined();
    expect(judgePass(analysis, 0.1)).toEqual({ reachable: false, lowerBoundAtLeast: undefined });
  });
});

describe("analyzeCalibration on levels", () => {
  it("uses ordinal alpha in the gap and the alpha floor for the raters", () => {
    const rng = createRng(7);
    const quality = Array.from({ length: 60 }, () => 1 + Math.floor(rng.uniform() * 5));
    const analysis = analyzeCalibration(
      {
        scale: "levels",
        levels: 5,
        units: units(60, (item) => quality[item]!),
      },
      settings,
    );
    expect(analysis.statistic).toBe("krippendorff-alpha-ordinal");
    expect(analysis.sensitivity).toBeUndefined();
    expect(analysis.conditions.ratersFloor.floor).toBe(0.667);
    expect(analysis.status).toBe("calibrated");
    expect(analysis.armBias.estimate).toBe(0);
  });
});

describe("analyzeCalibration refuses input it cannot analyze", () => {
  const good = units(10, readers(8, 0.3, [0.9, 0.9, 0.9]));
  const refuse = (change: (u: CalibrationUnit[]) => CalibrationUnit[], message: RegExp): void => {
    expect(() =>
      analyzeCalibration({ scale: "binary", units: change(good.map((u) => ({ ...u }))) }, settings),
    ).toThrow(message);
  };

  it("an item in two strata", () => {
    refuse((u) => [{ ...u[0]!, stratum: "other" }, ...u.slice(1)], /item-0.*one stratum/);
  });
  it("a weight below 1", () => {
    refuse((u) => [{ ...u[0]!, weight: 0.5 }, ...u.slice(1)], /weight/);
  });
  it("a label outside the scale", () => {
    refuse((u) => [{ ...u[0]!, judge: 2 }, ...u.slice(1)], /label/);
  });
  it("no candidate answer", () => {
    refuse((u) => u.filter((x) => x.configuration !== "candidate"), /base and candidate/);
  });
  it("weighted levels, which ordinal alpha cannot take", () => {
    expect(() =>
      analyzeCalibration(
        {
          scale: "levels",
          levels: 5,
          units: units(10, () => 3, { weight: (item) => (item === 0 ? 2 : 1) }),
        },
        settings,
      ),
    ).toThrow(/levels.*weight/);
  });
});
