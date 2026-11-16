// The operating characteristics of a judge calibration rule: how often a judge that is as good as a
// rater, worse than a rater, or biased between the two configurations passes it, on synthetic
// raters and 60 cases × the two configurations a plan names. The rule is a parameter: this module
// never imports one, so the rule can live wherever the calibration code does, and a changed rule
// only needs a rerun (VALIDATION.md, "The judge calibration rule").
import type { Rng } from "../../src/stats/index.ts";

/** One simulated calibration study: three label vectors on the same items. */
export interface RatedStudy {
  /** `binary` labels are 0 or 1; `levels` labels are 1 to `levels`. */
  readonly scale: "binary" | "levels";
  /** The number of levels, for the `levels` scale. */
  readonly levels: number;
  /** Cases. Item 2c is case c under the first configuration, item 2c + 1 under the second. */
  readonly cases: number;
  readonly first: readonly number[];
  readonly second: readonly number[];
  readonly judge: readonly number[];
}

/** What a rule decides about one study, and the bias bound that its equivalence check uses. */
export interface RuleOutcome {
  /** Whether the agreement condition holds (the judge agrees with each rater about as well as they agree). */
  readonly agreementPass: boolean;
  /** max(|lower|, |upper|) of the interval of the bias between the two configurations, on [0, 1]. */
  readonly shownBound: number;
  /** The mean of the per-case bias, on [0, 1]. */
  readonly armBias: number;
  /** Resamples whose agreement statistic was undefined; counted, never dropped silently. */
  readonly nanReplicates: number;
  /** All resamples. */
  readonly replicates: number;
}

/** A calibration rule: it reads one study and draws its resamples from `rng`. */
export type CalibrationRule = (study: RatedStudy, rng: Rng) => RuleOutcome;

/** A cell of the study: one synthetic scenario. */
export type Cell =
  | {
      readonly id: string;
      readonly scale: "binary";
      /** The share of positive (defect) items before case effects. */
      readonly prevalence: number;
      readonly raterAccuracy: number;
      readonly judgeAccuracy: number;
      /** How much more often the judge misses a positive under the second configuration. */
      readonly armBias: number;
    }
  | {
      readonly id: string;
      readonly scale: "levels";
      /** The noise of a rater's reading of the latent quality. */
      readonly raterNoise: number;
      readonly judgeNoise: number;
      /** How far the judge shifts its reading under the second configuration, on the latent scale. */
      readonly armShift: number;
    };

/** The cells of the published study (VALIDATION.md): the scenarios of the design's planning runs. */
export const CELLS: readonly Cell[] = [
  {
    id: "binary-equal",
    scale: "binary",
    prevalence: 0.2,
    raterAccuracy: 0.9,
    judgeAccuracy: 0.9,
    armBias: 0,
  },
  {
    id: "binary-slightly-worse",
    scale: "binary",
    prevalence: 0.2,
    raterAccuracy: 0.9,
    judgeAccuracy: 0.85,
    armBias: 0,
  },
  {
    id: "binary-worse",
    scale: "binary",
    prevalence: 0.2,
    raterAccuracy: 0.9,
    judgeAccuracy: 0.8,
    armBias: 0,
  },
  {
    id: "binary-equal-rare",
    scale: "binary",
    prevalence: 0.1,
    raterAccuracy: 0.9,
    judgeAccuracy: 0.9,
    armBias: 0,
  },
  {
    id: "binary-worse-rare",
    scale: "binary",
    prevalence: 0.1,
    raterAccuracy: 0.9,
    judgeAccuracy: 0.8,
    armBias: 0,
  },
  {
    id: "binary-bias-0.05",
    scale: "binary",
    prevalence: 0.2,
    raterAccuracy: 0.9,
    judgeAccuracy: 0.9,
    armBias: 0.05,
  },
  {
    id: "binary-bias-0.10",
    scale: "binary",
    prevalence: 0.2,
    raterAccuracy: 0.9,
    judgeAccuracy: 0.9,
    armBias: 0.1,
  },
  {
    id: "binary-bias-0.15",
    scale: "binary",
    prevalence: 0.2,
    raterAccuracy: 0.9,
    judgeAccuracy: 0.9,
    armBias: 0.15,
  },
  { id: "levels-equal", scale: "levels", raterNoise: 0.6, judgeNoise: 0.6, armShift: 0 },
  { id: "levels-noisier", scale: "levels", raterNoise: 0.6, judgeNoise: 0.9, armShift: 0 },
  { id: "levels-much-noisier", scale: "levels", raterNoise: 0.6, judgeNoise: 1.2, armShift: 0 },
  { id: "levels-shift-0.25", scale: "levels", raterNoise: 0.6, judgeNoise: 0.6, armShift: 0.25 },
  { id: "levels-shift-0.50", scale: "levels", raterNoise: 0.6, judgeNoise: 0.6, armShift: 0.5 },
];

/** The bias tolerances and limits at which the study reports P(shown bound ≤ m). */
export const MARGINS = [0.1, 0.15, 0.2, 0.25] as const;
/** Cases per study, as in the chatbot's first calibration study. */
export const CASES = 60;
/** The five levels' cut points on the latent scale. */
const CUTS = [-1.2, -0.4, 0.4, 1.2] as const;

function gaussian(rng: Rng): number {
  // Box–Muller; 1 − u keeps the logarithm's argument in (0, 1].
  return Math.sqrt(-2 * Math.log(1 - rng.uniform())) * Math.cos(2 * Math.PI * rng.uniform());
}

function level(latent: number): number {
  let l = 1;
  for (const cut of CUTS) if (latent >= cut) l += 1;
  return l;
}

/** Draws one synthetic calibration study for a cell: CASES cases, two items each. */
export function drawStudy(cell: Cell, rng: Rng, cases = CASES): RatedStudy {
  const first: number[] = [];
  const second: number[] = [];
  const judge: number[] = [];
  for (let c = 0; c < cases; c++) {
    // A case effect that both configurations' items share.
    const caseEffect = gaussian(rng) * 0.7;
    for (let configuration = 0; configuration < 2; configuration++) {
      if (cell.scale === "levels") {
        const truth = caseEffect + gaussian(rng) * 0.7;
        first.push(level(truth + gaussian(rng) * cell.raterNoise));
        second.push(level(truth + gaussian(rng) * cell.raterNoise));
        const shift = configuration === 1 ? cell.armShift : 0;
        judge.push(level(truth + gaussian(rng) * cell.judgeNoise + shift));
      } else {
        const p = Math.min(0.95, Math.max(0.02, cell.prevalence * Math.exp(caseEffect * 0.5)));
        const truth = rng.uniform() < p ? 1 : 0;
        const read = (accuracy: number): number => (rng.uniform() < accuracy ? truth : 1 - truth);
        first.push(read(cell.raterAccuracy));
        second.push(read(cell.raterAccuracy));
        let j = read(cell.judgeAccuracy);
        // Under the second configuration the judge misses positives more often.
        if (configuration === 1 && j === 1 && rng.uniform() < cell.armBias / cell.prevalence) j = 0;
        judge.push(j);
      }
    }
  }
  return { scale: cell.scale, levels: 5, cases, first, second, judge };
}

/** What a cell's studies give: rates with their Monte Carlo standard errors. */
export interface CellResult {
  readonly cell: string;
  readonly studies: number;
  readonly agreementPass: number;
  readonly agreementPassSe: number;
  readonly meanArmBias: number;
  readonly meanShownBound: number;
  /** P(shown bound ≤ m) for each m of MARGINS: the equivalence check at tolerance m, or a limit of m. */
  readonly withinMargin: readonly number[];
  readonly nanShare: number;
}

/** Runs `studies` studies of one cell through `rule`, from one seeded stream. */
export function runCell(cell: Cell, rule: CalibrationRule, rng: Rng, studies: number): CellResult {
  let passes = 0;
  let bias = 0;
  let bound = 0;
  let nan = 0;
  let replicates = 0;
  const within = MARGINS.map(() => 0);
  for (let s = 0; s < studies; s++) {
    const outcome = rule(drawStudy(cell, rng), rng);
    if (outcome.agreementPass) passes += 1;
    bias += outcome.armBias;
    bound += outcome.shownBound;
    nan += outcome.nanReplicates;
    replicates += outcome.replicates;
    MARGINS.forEach((m, i) => {
      if (outcome.shownBound <= m) within[i]! += 1;
    });
  }
  const rate = passes / studies;
  return {
    cell: cell.id,
    studies,
    agreementPass: rate,
    agreementPassSe: Math.sqrt((rate * (1 - rate)) / studies),
    meanArmBias: bias / studies,
    meanShownBound: bound / studies,
    withinMargin: within.map((count) => count / studies),
    nanShare: replicates === 0 ? 0 : nan / replicates,
  };
}
