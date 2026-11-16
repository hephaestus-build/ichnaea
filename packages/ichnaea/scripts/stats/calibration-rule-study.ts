// The operating characteristics of a judge calibration rule: how often a judge that is as good as a
// rater, worse than a rater, uninformative or biased between the two configurations passes it, on
// synthetic raters. Two kinds of synthetic study: generic cells (cases × the two configurations a
// plan names), and draw cells that reproduce a calibration draw (a screen of items with repeated
// answers, a deterministic proxy, oversampled positives, inclusion weights and within-item
// correlation). The rule is a parameter: this module never imports one, so the rule can live
// wherever the calibration code does, and a changed rule only needs a rerun (VALIDATION.md, "The
// judge calibration rule").
import { qnorm, type Rng } from "../../src/stats/index.ts";

/**
 * One simulated calibration study: labels on answers, which are grouped into cases (the resampling
 * clusters, items in a calibration study's own words), each case in one sampling stratum.
 */
export interface RatedStudy {
  /** `binary` labels are 0 or 1 (1 is a positive, a defect); `levels` labels are 1 to `levels`. */
  readonly scale: "binary" | "levels";
  /** The number of levels, for the `levels` scale. */
  readonly levels: number;
  /** The number of cases. */
  readonly cases: number;
  /** Per answer: its case, 0 to cases − 1. */
  readonly caseOf: readonly number[];
  /**
   * Per answer: its configuration. 0 and 1 are the two configurations the plan names, which the
   * bias check compares; 2 is an extra source of answers (a known-worse configuration).
   */
  readonly configurationOf: readonly number[];
  /** Per answer: its weight, 1/π for inclusion probability π (1 when every answer is sampled). */
  readonly weight: readonly number[];
  /** Per case: its stratum for the bootstrap, which resamples cases within each stratum. */
  readonly stratumOf: readonly number[];
  readonly first: readonly number[];
  readonly second: readonly number[];
  readonly judge: readonly number[];
  /** Per answer, for the study's diagnostics only: whether it truly is a positive. */
  readonly truth?: readonly number[];
}

/** What a rule decides about one study, and the bias bound that its equivalence check uses. */
export interface RuleOutcome {
  /** Whether the rule's agreement part admits the judge. */
  readonly pass: boolean;
  /** Each condition the rule reports, by name. */
  readonly conditions: Readonly<Record<string, boolean>>;
  /** max(|lower|, |upper|) of the interval of the bias between the two configurations, on [0, 1]. */
  readonly shownBound: number;
  /** The bias between the two configurations, on [0, 1]. */
  readonly armBias: number;
  /** Resamples in which a status statistic was undefined; counted, never dropped silently. */
  readonly nanReplicates: number;
  /** All resamples. */
  readonly replicates: number;
  /** The judge's slope on the base (0) against known-worse (2) pair, when the study has that pair. */
  readonly slope?: Slope;
}

/** The judge's slope against people on the base against known-worse pair, on quality (1 − defect). */
export interface Slope {
  /** β = judge change ÷ human change. */
  readonly estimate: number;
  /** The one-sided 95 % item-cluster lower bound of β, capped at 1. */
  readonly lower: number;
  /** The human change (the raters' mean quality on known-worse minus base); negative is a drop. */
  readonly humanChange: number;
  /** Its one-sided 95 % upper bound: the drop is shown when it is below 0. */
  readonly humanChangeUpper: number;
  /** The shown bound of (judge change − human change) on this pair: B. */
  readonly pairBound: number;
}

/** A calibration rule: the conditions it reports, and its evaluation of one study. */
export interface CalibrationRule {
  /** Every condition name the rule can report, in the study's column order. */
  readonly conditions: readonly string[];
  /** Reads one study and draws its resamples from `rng`. */
  readonly evaluate: (study: RatedStudy, rng: Rng) => RuleOutcome;
}

/**
 * How a yes/no judge reads an answer: like a rater with its own accuracy; at chance, saying yes
 * with the cell's prevalence whatever the answer is; or always no.
 */
export type BinaryJudge = "reads" | "chance" | "always-no";

/** One group of a calibration draw: the answers drawn from one configuration. */
export interface DrawGroup {
  /** The configuration: 0 and 1 are the two the plan names, 2 is the known-worse one. */
  readonly configuration: 0 | 1 | 2;
  /** Answers drawn from it. */
  readonly units: number;
  /** The share of them wanted from its proxy-positive answers. */
  readonly positiveShare: number;
}

/** A calibration draw, as a calibration study's sampling plan states it. */
export interface DrawDesign {
  /** Eligible items, after the development pool. */
  readonly items: number;
  /** Screening runs per item, per configuration 0, 1 and 2 (0 runs: the configuration is not screened). */
  readonly runs: readonly [number, number, number];
  /** The share of each configuration's answers that are truly positive (defects). */
  readonly defectRate: readonly [number, number, number];
  readonly groups: readonly DrawGroup[];
  /** The most proxy-positive answers drawn from one item, over all groups; none when absent. */
  readonly positiveCap?: number;
  /** The raters' accuracy, which sets human–human agreement; RATER_ACCURACY when absent. */
  readonly raterAccuracy?: number;
  /** The share of true defects that the proxy catches; PROXY_CATCHES when absent. */
  readonly proxyRecall?: number;
}

/** A cell of the study: one synthetic scenario. */
export type Cell =
  | {
      readonly id: string;
      readonly scale: "binary";
      /** The share of positive answers, before case effects. Oversampling raises it. */
      readonly prevalence: number;
      /** True when `prevalence` comes from oversampling positives by stratification. */
      readonly oversampled: boolean;
      readonly raterAccuracy: number;
      readonly judge: BinaryJudge;
      /** For a judge that `reads`: its accuracy. */
      readonly judgeAccuracy: number;
      /** How much more often the judge misses a positive under the second configuration. */
      readonly armBias: number;
      /** Cases per study. */
      readonly cases: number;
    }
  | {
      readonly id: string;
      readonly scale: "levels";
      /** The noise of a rater's reading of the latent quality. */
      readonly raterNoise: number;
      readonly judgeNoise: number;
      /** How far the judge shifts its reading under the second configuration, on the latent scale. */
      readonly armShift: number;
    }
  | {
      readonly id: string;
      readonly scale: "draw";
      readonly design: DrawDesign;
      readonly judgeAccuracy: number;
      /** The within-item correlation of the latent defect and of each reader's errors. */
      readonly rho: number;
    };

/** Cases per study unless a cell names more, as in the chatbot's first calibration study. */
export const CASES = 60;

const binary = (
  id: string,
  prevalence: number,
  judge: BinaryJudge,
  judgeAccuracy: number,
  { armBias = 0, oversampled = false, cases = CASES } = {},
): Cell => ({
  id,
  scale: "binary",
  prevalence,
  oversampled,
  raterAccuracy: 0.9,
  judge,
  judgeAccuracy,
  armBias,
  cases,
});

/** The study sizes that the generic sizing cells try, with positives oversampled to 0.35. */
export const SIZES = [120, 135, 150, 180] as const;

/** A draw with the known-worse configuration C3: groups of n1, n1 and n3 answers, positives capped. */
const withC3 = (n1: number, n3: number, positiveCap?: number): DrawDesign => ({
  items: 127,
  runs: [2, 2, 2],
  defectRate: [0.15, 0.15, 0.35],
  ...(positiveCap === undefined ? {} : { positiveCap }),
  groups: [
    { configuration: 0, units: n1, positiveShare: 0.35 },
    { configuration: 1, units: n1, positiveShare: 0.35 },
    { configuration: 2, units: n3, positiveShare: 0.6 },
  ],
});

/**
 * The draws studied for the chatbot's first calibration study (VALIDATION.md): 127 eligible items,
 * two screening runs per configuration, defect rates from its November runs, and the known-worse
 * configuration C3 (configuration 2) as a source of positives.
 */
export const DRAWS: Readonly<Record<string, DrawDesign>> = {
  "two-arms-140": {
    items: 127,
    runs: [2, 2, 0],
    defectRate: [0.15, 0.15, 0.35],
    groups: [
      { configuration: 0, units: 70, positiveShare: 0.35 },
      { configuration: 1, units: 70, positiveShare: 0.35 },
    ],
  },
  "with-c3-140": withC3(45, 50),
  "with-c3-140-cap2": withC3(45, 50, 2),
  "with-c3-200-cap2": withC3(60, 80, 2),
  "with-c3-260-cap2": withC3(75, 110, 2),
};
/** The within-item correlations that the draw cells try. */
export const RHOS = [0, 0.3, 0.6] as const;

/** The cells of the published study (VALIDATION.md). */
export const CELLS: readonly Cell[] = [
  binary("binary-equal", 0.2, "reads", 0.9),
  binary("binary-slightly-worse", 0.2, "reads", 0.85),
  binary("binary-worse", 0.2, "reads", 0.8),
  binary("binary-equal-rare", 0.1, "reads", 0.9),
  binary("binary-worse-rare", 0.1, "reads", 0.8),
  binary("binary-bias-0.05", 0.2, "reads", 0.9, { armBias: 0.05 }),
  binary("binary-bias-0.10", 0.2, "reads", 0.9, { armBias: 0.1 }),
  binary("binary-bias-0.15", 0.2, "reads", 0.9, { armBias: 0.15 }),
  // Uninformative judges at low prevalence, where an AC1 rule alone can admit them.
  binary("binary-chance-rare", 0.1, "chance", 0),
  binary("binary-always-no-rare", 0.1, "always-no", 0),
  binary("binary-chance-very-rare", 0.05, "chance", 0),
  binary("binary-always-no-very-rare", 0.05, "always-no", 0),
  // The same at prevalence 0.1 in the population, with positives oversampled to 0.35 of the sample.
  binary("binary-equal-oversampled", 0.35, "reads", 0.9, { oversampled: true }),
  binary("binary-worse-oversampled", 0.35, "reads", 0.8, { oversampled: true }),
  binary("binary-chance-oversampled", 0.35, "chance", 0, { oversampled: true }),
  binary("binary-always-no-oversampled", 0.35, "always-no", 0, { oversampled: true }),
  // Generic sizing: the good and the clearly worse judge at larger studies.
  ...SIZES.flatMap((cases) => [
    binary(`binary-equal-oversampled-n${cases}`, 0.35, "reads", 0.9, { oversampled: true, cases }),
    binary(`binary-worse-oversampled-n${cases}`, 0.35, "reads", 0.8, { oversampled: true, cases }),
  ]),
  { id: "levels-equal", scale: "levels", raterNoise: 0.6, judgeNoise: 0.6, armShift: 0 },
  { id: "levels-noisier", scale: "levels", raterNoise: 0.6, judgeNoise: 0.9, armShift: 0 },
  { id: "levels-much-noisier", scale: "levels", raterNoise: 0.6, judgeNoise: 1.2, armShift: 0 },
  { id: "levels-shift-0.25", scale: "levels", raterNoise: 0.6, judgeNoise: 0.6, armShift: 0.25 },
  { id: "levels-shift-0.50", scale: "levels", raterNoise: 0.6, judgeNoise: 0.6, armShift: 0.5 },
  // The chatbot's draw, for the good (0.90) and the clearly worse (0.80) judge, at each ρ.
  ...Object.entries(DRAWS).flatMap(([name, design]) =>
    RHOS.flatMap((rho) =>
      (
        [
          ["equal", 0.9],
          ["worse", 0.8],
        ] as const
      ).map(([who, judgeAccuracy]): Cell => ({
        id: `draw-${name}-rho${rho}-${who}`,
        scale: "draw",
        design,
        judgeAccuracy,
        rho,
      })),
    ),
  ),
];

/** The bias tolerances and limits at which the study reports P(shown bound ≤ m). */
export const MARGINS = [0.1, 0.15, 0.2, 0.25] as const;
/** The slope lower bounds at which the study reports P(β_L ≥ s). */
export const SLOPE_LEVELS = [0.5, 0.7, 0.9] as const;
/** The measure's limit for the Pass margin β_L · limit − B. */
export const LIMIT = 0.1;
/** The five levels' cut points on the latent scale. */
const CUTS = [-1.2, -0.4, 0.4, 1.2] as const;
/** The draw model's raters read with this accuracy. */
const RATER_ACCURACY = 0.9;
/** The share of true defects that the deterministic proxy catches (the obvious ones). */
const PROXY_CATCHES = 0.65;
/** The share of non-defects that the proxy flags anyway. */
const PROXY_FALSE_POSITIVE = 0.01;
/** Readers are this much more accurate on an obvious defect, and this much less on a subtle one. */
const OBVIOUS_SHIFT = 0.07;

function gaussian(rng: Rng): number {
  // Box–Muller; 1 − u keeps the logarithm's argument in (0, 1].
  return Math.sqrt(-2 * Math.log(1 - rng.uniform())) * Math.cos(2 * Math.PI * rng.uniform());
}

function level(latent: number): number {
  let l = 1;
  for (const cut of CUTS) if (latent >= cut) l += 1;
  return l;
}

/** Draws one synthetic calibration study for a cell. */
export function drawStudy(cell: Cell, rng: Rng): RatedStudy {
  return cell.scale === "draw" ? drawCalibration(cell, rng) : drawGeneric(cell, rng);
}

/** A generic study: its cases, one answer per configuration each, every answer sampled. */
function drawGeneric(cell: Exclude<Cell, { scale: "draw" }>, rng: Rng): RatedStudy {
  const cases = cell.scale === "binary" ? cell.cases : CASES;
  const first: number[] = [];
  const second: number[] = [];
  const judge: number[] = [];
  const caseOf: number[] = [];
  const configurationOf: number[] = [];
  for (let c = 0; c < cases; c++) {
    // A case effect that both of the case's answers share.
    const caseEffect = gaussian(rng) * 0.7;
    for (let configuration = 0; configuration < 2; configuration++) {
      caseOf.push(c);
      configurationOf.push(configuration);
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
        let j: number;
        if (cell.judge === "always-no") j = 0;
        else if (cell.judge === "chance") j = rng.uniform() < cell.prevalence ? 1 : 0;
        else j = read(cell.judgeAccuracy);
        // Under the second configuration the judge misses positives more often.
        if (configuration === 1 && j === 1 && rng.uniform() < cell.armBias / cell.prevalence) j = 0;
        judge.push(j);
      }
    }
  }
  return {
    scale: cell.scale,
    levels: 5,
    cases,
    caseOf,
    configurationOf,
    weight: caseOf.map(() => 1),
    stratumOf: Array.from({ length: cases }, () => 0),
    first,
    second,
    judge,
  };
}

/** A screened answer before the draw. */
interface Screened {
  readonly item: number;
  readonly configuration: 0 | 1 | 2;
  readonly truth: number;
  readonly obvious: boolean;
  readonly proxy: boolean;
}

/** Fisher–Yates on a copy, from `rng`. */
function shuffled<T>(xs: readonly T[], rng: Rng): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.uniform() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * A calibration draw, as the chatbot's sampling plan states it:
 * 1. Screen: each item gets the design's runs per configuration. An answer is a defect when its
 *    latent √ρ·u_item + √(1−ρ)·e exceeds the threshold of its configuration's defect rate, so
 *    defects cluster within items with correlation ρ. The proxy catches a defect with probability
 *    PROXY_CATCHES (an obvious defect) and flags a non-defect with PROXY_FALSE_POSITIVE.
 * 2. Draw: each group takes round(positiveShare · units) of its configuration's proxy-positive
 *    answers (all of them if fewer exist) and the rest from its proxy-negative answers, by simple
 *    random sampling within those two strata, so π = n_s/N_s. With a positive cap, each item's
 *    proxy-positive answers are first thinned at random to the cap, and π is multiplied by the
 *    thinning share.
 * 3. Label: two raters and the judge read each drawn answer. A reader is correct with its accuracy,
 *    shifted up on an obvious defect and down on a subtle one; its errors correlate within an item
 *    through √ρ·z_item + √(1−ρ)·ε, the reader's own item effect.
 * The bootstrap strata are items with a drawn proxy-positive answer, and the rest.
 */
function drawCalibration(cell: Extract<Cell, { scale: "draw" }>, rng: Rng): RatedStudy {
  const { design, rho } = cell;
  const shared = Math.sqrt(rho);
  const own = Math.sqrt(1 - rho);
  const screened: Screened[] = [];
  for (let item = 0; item < design.items; item++) {
    const u = gaussian(rng);
    for (const configuration of [0, 1, 2] as const) {
      const threshold = qnorm(1 - design.defectRate[configuration]);
      for (let run = 0; run < design.runs[configuration]; run++) {
        const truth = shared * u + own * gaussian(rng) > threshold ? 1 : 0;
        const obvious = truth === 1 && rng.uniform() < (design.proxyRecall ?? PROXY_CATCHES);
        const proxy = obvious || (truth === 0 && rng.uniform() < PROXY_FALSE_POSITIVE);
        screened.push({ item, configuration, truth, obvious, proxy });
      }
    }
  }

  // Thin each item's proxy-positive answers to the cap; keep each answer's thinning share.
  const kept = new Map<Screened, number>();
  for (let item = 0; item < design.items; item++) {
    const positives = screened.filter((s) => s.item === item && s.proxy);
    const cap = design.positiveCap ?? positives.length;
    const keep = shuffled(positives, rng).slice(0, cap);
    for (const s of keep) kept.set(s, keep.length / positives.length);
  }

  const drawn: { answer: Screened; weight: number }[] = [];
  for (const group of design.groups) {
    const answers = screened.filter((s) => s.configuration === group.configuration);
    const positives = answers.filter((s) => s.proxy && kept.has(s));
    const negatives = answers.filter((s) => !s.proxy);
    const wantedPositives = Math.min(
      Math.round(group.positiveShare * group.units),
      positives.length,
    );
    const wantedNegatives = Math.min(group.units - wantedPositives, negatives.length);
    for (const s of shuffled(positives, rng).slice(0, wantedPositives)) {
      drawn.push({ answer: s, weight: 1 / ((wantedPositives / positives.length) * kept.get(s)!) });
    }
    for (const s of shuffled(negatives, rng).slice(0, wantedNegatives)) {
      drawn.push({ answer: s, weight: negatives.length / wantedNegatives });
    }
  }

  // Renumber the drawn items as cases, and label every drawn answer.
  const caseIndex = new Map<number, number>();
  for (const { answer } of drawn) {
    if (!caseIndex.has(answer.item)) caseIndex.set(answer.item, caseIndex.size);
  }
  const readerEffect = (): Map<number, number> =>
    new Map([...caseIndex.keys()].map((item) => [item, gaussian(rng)] as const));
  const effects = [readerEffect(), readerEffect(), readerEffect()];
  const read = (reader: number, s: Screened, accuracy: number): number => {
    const shifted =
      s.truth === 0 ? accuracy : accuracy + (s.obvious ? OBVIOUS_SHIFT : -OBVIOUS_SHIFT);
    const p = Math.min(0.995, Math.max(0.005, shifted));
    const correct = shared * effects[reader]!.get(s.item)! + own * gaussian(rng) < qnorm(p);
    return correct ? s.truth : 1 - s.truth;
  };
  const hasPositive = new Set(drawn.filter((d) => d.answer.proxy).map((d) => d.answer.item));
  return {
    scale: "binary",
    levels: 5,
    cases: caseIndex.size,
    caseOf: drawn.map((d) => caseIndex.get(d.answer.item)!),
    configurationOf: drawn.map((d) => d.answer.configuration),
    weight: drawn.map((d) => d.weight),
    stratumOf: [...caseIndex.keys()].map((item) => (hasPositive.has(item) ? 1 : 0)),
    first: drawn.map((d) => read(0, d.answer, design.raterAccuracy ?? RATER_ACCURACY)),
    second: drawn.map((d) => read(1, d.answer, design.raterAccuracy ?? RATER_ACCURACY)),
    judge: drawn.map((d) => read(2, d.answer, cell.judgeAccuracy)),
    truth: drawn.map((d) => d.answer.truth),
  };
}

/** What a cell's studies give: rates with their Monte Carlo standard errors. */
export interface CellResult {
  readonly cell: string;
  readonly studies: number;
  readonly pass: number;
  readonly passSe: number;
  /** P(condition holds) for each of the rule's conditions, NaN where the cell's scale has none. */
  readonly conditions: readonly number[];
  readonly meanArmBias: number;
  readonly meanShownBound: number;
  /** P(shown bound ≤ m) for each m of MARGINS: the equivalence check at tolerance m, or a limit of m. */
  readonly withinMargin: readonly number[];
  readonly nanShare: number;
  /** Per study, on average: the drawn answers that truly are positive (NaN without truth). */
  readonly meanPositives: number;
  /** Per study, on average: the distinct items among them. */
  readonly meanPositiveItems: number;
  /** Per study, on average: Kish's effective number of positives, (Σw)² / Σw² over them. */
  readonly meanEffectivePositives: number;
  /** The slope, where the cell has a known-worse configuration; NaN otherwise. */
  readonly meanSlope: number;
  readonly meanSlopeLower: number;
  /** P(β_L ≥ s) for each s of SLOPE_LEVELS. */
  readonly slopeLowerAtLeast: readonly number[];
  /** P(the human-rated drop is shown: the human change's upper bound is below 0). */
  readonly dropShown: number;
  /** The human-rated drop from base to known-worse, on quality, on average. */
  readonly meanHumanDrop: number;
  /** P(β_L · LIMIT − B > 0), with B the bias bound on the base against known-worse pair. */
  readonly passable: number;
}

/** Runs `studies` studies of one cell through `rule`, from one seeded stream. */
export function runCell(cell: Cell, rule: CalibrationRule, rng: Rng, studies: number): CellResult {
  let passes = 0;
  let bias = 0;
  let bound = 0;
  let nan = 0;
  let replicates = 0;
  let positives = 0;
  let positiveItems = 0;
  let effective = 0;
  let withTruth = 0;
  let withSlope = 0;
  let slopeSum = 0;
  let slopeLowerSum = 0;
  let dropShown = 0;
  let dropSum = 0;
  let passable = 0;
  const slopeAtLeast = SLOPE_LEVELS.map(() => 0);
  const holds = rule.conditions.map(() => 0);
  const reported = rule.conditions.map(() => 0);
  const within = MARGINS.map(() => 0);
  for (let s = 0; s < studies; s++) {
    const study = drawStudy(cell, rng);
    const outcome = rule.evaluate(study, rng);
    if (outcome.pass) passes += 1;
    rule.conditions.forEach((name, i) => {
      const value = outcome.conditions[name];
      if (value === undefined) return;
      reported[i]! += 1;
      if (value) holds[i]! += 1;
    });
    bias += outcome.armBias;
    bound += outcome.shownBound;
    nan += outcome.nanReplicates;
    replicates += outcome.replicates;
    MARGINS.forEach((m, i) => {
      if (outcome.shownBound <= m) within[i]! += 1;
    });
    if (outcome.slope) {
      const { estimate, lower, humanChange, humanChangeUpper, pairBound } = outcome.slope;
      withSlope += 1;
      slopeSum += estimate;
      slopeLowerSum += lower;
      dropSum += -humanChange;
      if (humanChangeUpper < 0) dropShown += 1;
      if (lower * LIMIT - pairBound > 0) passable += 1;
      SLOPE_LEVELS.forEach((threshold, i) => {
        if (lower >= threshold) slopeAtLeast[i]! += 1;
      });
    }
    if (study.truth) {
      withTruth += 1;
      const index = study.truth.flatMap((t, i) => (t === 1 ? [i] : []));
      const w = index.map((i) => study.weight[i]!);
      const sum = w.reduce((x, y) => x + y, 0);
      const squares = w.reduce((x, y) => x + y * y, 0);
      positives += index.length;
      positiveItems += new Set(index.map((i) => study.caseOf[i])).size;
      effective += squares === 0 ? 0 : (sum * sum) / squares;
    }
  }
  const rate = passes / studies;
  const perStudy = (x: number): number => (withTruth === 0 ? Number.NaN : x / withTruth);
  return {
    cell: cell.id,
    studies,
    pass: rate,
    passSe: Math.sqrt((rate * (1 - rate)) / studies),
    conditions: holds.map((h, i) => (reported[i] === 0 ? Number.NaN : h / reported[i]!)),
    meanArmBias: bias / studies,
    meanShownBound: bound / studies,
    withinMargin: within.map((count) => count / studies),
    nanShare: replicates === 0 ? 0 : nan / replicates,
    meanPositives: perStudy(positives),
    meanPositiveItems: perStudy(positiveItems),
    meanEffectivePositives: perStudy(effective),
    meanSlope: withSlope === 0 ? Number.NaN : slopeSum / withSlope,
    meanSlopeLower: withSlope === 0 ? Number.NaN : slopeLowerSum / withSlope,
    slopeLowerAtLeast: slopeAtLeast.map((n) => (withSlope === 0 ? Number.NaN : n / withSlope)),
    dropShown: withSlope === 0 ? Number.NaN : dropShown / withSlope,
    meanHumanDrop: withSlope === 0 ? Number.NaN : dropSum / withSlope,
    passable: withSlope === 0 ? Number.NaN : passable / withSlope,
  };
}
