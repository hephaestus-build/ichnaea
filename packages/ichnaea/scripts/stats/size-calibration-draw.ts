// Sizes a judge calibration draw from nuisance parameters only: the defect rates per configuration
// (which set the base against known-worse drop), the proxy's recall, the within-item correlation
// ρ, the raters' agreement, and the eligible items. It never reads anything measured on the judge:
// it tests a hypothetical good judge (as accurate as a rater) and a clearly worse one (0.10 less),
// so a pilot's judge readout cannot steer the size.
//   node scripts/stats/size-calibration-draw.ts --defect 0.15,0.15,0.35 --proxy-recall 0.65 \
//     --rho 0.3 --rater-agreement 0.82 --items 127 --sizes 200,260,300,360,460
// It prints one row per size and the smallest size that meets both targets, or "none".
import { parseArgs } from "node:util";

import { createRng } from "../../src/stats/rng.ts";
import { CONDITIONS, calibrationRule } from "./calibration-rule.ts";
import { WORSE_BY, designOf, runCell, type Cell, type Nuisance } from "./calibration-rule-study.ts";

/** The registered targets: the good judge passes at least this often, the worse one at most this. */
export const TARGET_GOOD = 0.8;
export const TARGET_WORSE = 0.05;

/**
 * The raters' accuracy from their raw agreement p, for two raters who err independently and
 * symmetrically: p = a² + (1 − a)², so a = (1 + √(2p − 1)) / 2.
 */
export function accuracyFromAgreement(p: number): number {
  if (!(p > 0.5 && p <= 1)) throw new RangeError(`raw agreement must be in (0.5, 1], got ${p}`);
  return (1 + Math.sqrt(2 * p - 1)) / 2;
}

/** One size's result. */
export interface SizeResult {
  readonly size: number;
  readonly good: number;
  readonly worse: number;
  readonly goodSlopeLower: number;
  readonly dropShown: number;
  readonly passable: number;
  /** P(the rater floor holds): the precondition, from the raters alone. */
  readonly floorMet: number;
  readonly meets: boolean;
}

/** Runs each size for the good and the worse judge, from one seed per size and judge. */
export function sizeDraw(
  nuisance: Nuisance,
  sizes: readonly number[],
  { studies = 1000, resamples = 1000, seed = 10_000_000 } = {},
): SizeResult[] {
  const rule = calibrationRule({ agreementTolerance: 0.15, rateTolerance: 0.1, resamples });
  return sizes.map((size, index) => {
    const cell = (judgeAccuracy: number, who: string): Cell => ({
      id: `size-${size}-${who}`,
      scale: "draw",
      design: designOf(size, nuisance),
      judgeAccuracy,
      rho: nuisance.rho,
    });
    const good = runCell(
      cell(nuisance.raterAccuracy, "good"),
      rule,
      createRng(seed + 2 * index),
      studies,
    );
    const worse = runCell(
      cell(nuisance.raterAccuracy - WORSE_BY, "worse"),
      rule,
      createRng(seed + 2 * index + 1),
      studies,
    );
    return {
      size,
      good: good.pass,
      worse: worse.pass,
      goodSlopeLower: good.meanSlopeLower,
      dropShown: good.dropShown,
      passable: good.passable,
      floorMet: good.conditions[CONDITIONS.indexOf("ratersFloor")]!,
      meets: good.pass >= TARGET_GOOD && worse.pass <= TARGET_WORSE,
    };
  });
}

function numbers(text: string | undefined, name: string): number[] {
  const values = (text ?? "").split(",").map(Number);
  if (values.length === 0 || values.some((v) => !Number.isFinite(v))) {
    throw new RangeError(`--${name} must be comma-separated numbers, got '${text}'`);
  }
  return values;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      defect: { type: "string" },
      "proxy-recall": { type: "string" },
      rho: { type: "string" },
      "rater-agreement": { type: "string" },
      "rater-accuracy": { type: "string" },
      items: { type: "string", default: "127" },
      runs: { type: "string", default: "2,2,2" },
      sizes: { type: "string" },
      studies: { type: "string", default: "1000" },
      resamples: { type: "string", default: "1000" },
    },
  });
  const defect = numbers(values.defect, "defect");
  const runs = numbers(values.runs, "runs");
  if (defect.length !== 3 || runs.length !== 3)
    throw new RangeError("--defect and --runs take three values (C1, C2, C3)");
  const raterAccuracy =
    values["rater-accuracy"] === undefined
      ? accuracyFromAgreement(Number(values["rater-agreement"]))
      : Number(values["rater-accuracy"]);
  const nuisance: Nuisance = {
    items: Number(values.items),
    runs: [runs[0]!, runs[1]!, runs[2]!],
    defectRate: [defect[0]!, defect[1]!, defect[2]!],
    proxyRecall: Number(values["proxy-recall"]),
    rho: Number(values.rho),
    raterAccuracy,
  };
  const results = sizeDraw(nuisance, numbers(values.sizes, "sizes"), {
    studies: Number(values.studies),
    resamples: Number(values.resamples),
  });
  console.log(
    ["size", "good", "worse", "goodSlopeLower", "dropShown", "passable", "floorMet", "meets"].join(
      "\t",
    ),
  );
  for (const r of results) {
    console.log(
      [
        r.size,
        r.good.toFixed(3),
        r.worse.toFixed(3),
        r.goodSlopeLower.toFixed(3),
        r.dropShown.toFixed(3),
        r.passable.toFixed(3),
        r.floorMet.toFixed(3),
        r.meets,
      ].join("\t"),
    );
  }
  const smallest = results.find((r) => r.meets);
  console.log(`smallest\t${smallest ? smallest.size : "none"}`);
}
