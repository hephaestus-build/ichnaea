// The points of the type-I study of the score permutation test (VALIDATION.md, "Score measures: the
// regression test"): every generator, grid shape, seed and test, fixed before any run. A point
// draws one data set per repetition; its test rejects at each level of score-type-i-rule.ts.
import {
  type CaseScores,
  createRng,
  exactStratifiedTest,
  pnorm,
  qnorm,
  type Rng,
  scorePermutationTest,
  type ScorePermutationResult,
} from "../../src/stats/index.ts";
import { scorePermutationCore } from "../../src/stats/score-permutation-core.ts";
import { ALPHA, LEVELS, STUDY_RESAMPLES, studyRejects } from "./score-type-i-rule.ts";

// --- Sampling -------------------------------------------------------------------------------------

export function normal(rng: Rng): number {
  let u = 0;
  while (u === 0) u = rng.uniform();
  return qnorm(u);
}

/** Gamma(shape, 1) by Marsaglia and Tsang, with the u^(1/a) boost below shape 1. */
export function gamma(rng: Rng, shape: number): number {
  if (shape < 1) {
    let u = 0;
    while (u === 0) u = rng.uniform();
    return gamma(rng, shape + 1) * u ** (1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = normal(rng);
    const v = (1 + c * x) ** 3;
    if (v <= 0) continue;
    const u = rng.uniform();
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}

/** Beta with mean mu and precision nu: Beta(mu·nu, (1 − mu)·nu). */
export function beta(rng: Rng, mu: number, nu: number): number {
  const x = gamma(rng, mu * nu);
  const y = gamma(rng, (1 - mu) * nu);
  return x / (x + y);
}

/** Passed items of m, with per-output pass probability from a beta of mean mu and ICC rho. */
export function betaBinomial(rng: Rng, m: number, mu: number, rho: number): number {
  const p = rho === 0 ? mu : beta(rng, mu, (1 - rho) / rho);
  let passed = 0;
  for (let i = 0; i < m; i++) if (rng.uniform() < p) passed++;
  return passed;
}

const clip = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

// --- Grid -----------------------------------------------------------------------------------------

export const CASE_COUNTS = [5, 8, 10, 12, 17, 20, 30, 60, 146] as const;
/** Trial patterns: in the domain (equal counts in both arms of each case), and outside it. */
export type Pattern = "r1" | "r2" | "r3" | "mixed" | "one-trial" | "c3b2" | "c2b3";

export interface Shape {
  readonly k: number;
  readonly pattern: Pattern;
}

/** Planned trials of case i: [candidate, base]. */
export function trialsOf(shape: Shape, i: number): readonly [number, number] {
  switch (shape.pattern) {
    case "r1":
      return [1, 1];
    case "r2":
      return [2, 2];
    case "r3":
      return [3, 3];
    case "mixed":
      return i % 2 === 0 ? [2, 2] : [3, 3];
    case "one-trial":
      return i < Math.floor(0.1 * shape.k) ? [1, 1] : [2, 2];
    case "c3b2":
      return [3, 2];
    case "c2b3":
      return [2, 3];
  }
}

/** The domain's shapes: 2 or 3 trials, mixed, and up to 10% one-trial cells (k ≥ 10). */
export const DOMAIN_SHAPES: readonly Shape[] = CASE_COUNTS.flatMap((k) => [
  ...(["r2", "r3", "mixed"] as const).map((pattern) => ({ k, pattern })),
  ...(k >= 10 ? [{ k, pattern: "one-trial" as const }] : []),
]);
/** One trial per case and arm: R-P is then a within-case sign flip. */
export const R1_CASE_COUNTS = [12, 17, 20, 30, 60, 100, 146, 200, 300] as const;
export const R1_SHAPES: readonly Shape[] = R1_CASE_COUNTS.map((k) => ({
  k,
  pattern: "r1" as const,
}));
/** Reported only: one trial per case below the grid, where the sign flip is known to fail. */
export const R1_REPORTED_SHAPES: readonly Shape[] = [5, 8, 10].map((k) => ({
  k,
  pattern: "r1" as const,
}));
/** Arm-unequal shapes, run and reported, outside the domain. */
export const UNEQUAL_SHAPES: readonly Shape[] = CASE_COUNTS.flatMap((k) =>
  (["c3b2", "c2b3"] as const).map((pattern) => ({ k, pattern })),
);

export const MEANS = [0.05, 0.2, 0.5, 0.8, 0.95] as const;
export const meanOf = (i: number): number => MEANS[i % MEANS.length] as number;

// --- Data -----------------------------------------------------------------------------------------

/** A trial value of case i in an arm at replicate j. */
export type Trial = (rng: Rng, i: number, arm: "candidate" | "base", j: number) => number;

export function dataset(rng: Rng, shape: Shape, trial: Trial): CaseScores[] {
  return Array.from({ length: shape.k }, (_, i) => {
    const [nc, nb] = trialsOf(shape, i);
    return {
      id: `c${i}`,
      candidate: Array.from({ length: nc }, (_trial, j) => trial(rng, i, "candidate", j)),
      base: Array.from({ length: nb }, (_trial, j) => trial(rng, i, "base", j)),
    };
  });
}

/** Per-case means of a heterogeneous structure: [base, candidate] for each case. */
export type Structure = readonly (readonly [number, number])[];

export const betaTrial =
  (
    means: (i: number, arm: "candidate" | "base") => number,
    nu: (arm: "candidate" | "base") => number,
  ): Trial =>
  (rng, i, arm) =>
    beta(rng, means(i, arm), nu(arm));

/** Run-level shocks: one per replicate and arm (separate) or per replicate (shared). */
function shocked(rng: Rng, shape: Shape, sigma: number, shared: boolean, nu: number): CaseScores[] {
  const replicates = 3;
  const shock = Array.from({ length: replicates }, () => {
    const candidate = sigma * normal(rng);
    return { candidate, base: shared ? candidate : sigma * normal(rng) };
  });
  return dataset(rng, shape, (r, i, arm, j) =>
    beta(
      r,
      clip(meanOf(i) + (shock[j] as { candidate: number; base: number })[arm], 0.01, 0.99),
      nu,
    ),
  );
}

/** Missing trials, then filled against a drop: a missing candidate trial is 1, a base trial 0. */
function imputed(
  rng: Rng,
  data: CaseScores[],
  centre: (i: number) => number,
  mechanism: "random" | "tied",
): CaseScores[] {
  const missing = (v: number, i: number): boolean =>
    mechanism === "random" ? rng.uniform() < 0.1 : v < centre(i) && rng.uniform() < 0.2;
  return data.map((c, i) => ({
    ...c,
    candidate: c.candidate.map((v) => (missing(v, i) ? 1 : v)),
    base: c.base.map((v) => (missing(v, i) ? 0 : v)),
  }));
}

export const LATENT_MEANS = [-1, -0.5, 0, 0.5, 1] as const;
export const THRESHOLDS = {
  even: [-1.5, -0.5, 0.5, 1.5],
  skewed: [-0.5, 0, 0.5, 1.5],
} as const;
export function likert(rng: Rng, i: number, thresholds: readonly number[]): number {
  const z = (LATENT_MEANS[i % LATENT_MEANS.length] as number) + normal(rng);
  return thresholds.filter((t) => t < z).length / 4;
}

// --- Tests ----------------------------------------------------------------------------------------

export type TestName =
  | "permutation"
  | "replicate-strata"
  | "wald"
  | "paired-t"
  | "binary-items"
  | "cross-case"
  | "holm";

/** The study's version of the shipped test: always Monte Carlo, STUDY_RESAMPLES resamples. */
const permutation = (data: CaseScores[], rng: Rng): number =>
  scorePermutationCore(data, { rng, resamples: STUDY_RESAMPLES, exact: false }).p;

/** Reported only: each (case, replicate) pair is its own stratum of one trial against one. */
function replicateStrata(data: CaseScores[], rng: Rng): number {
  const pairs = data.flatMap((c) =>
    c.candidate.flatMap((v, j) =>
      j < c.base.length
        ? [{ id: `${c.id}/${j}`, candidate: [v], base: [c.base[j] as number] }]
        : [],
    ),
  );
  return permutation(pairs, rng);
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const variance = (xs: readonly number[]): number => {
  const m = mean(xs);
  return xs.length < 2 ? 0 : xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
};

/** Must fail: a Wald z-test with plug-in within-case variances and no floor. */
function wald(data: CaseScores[]): number {
  let t = 0;
  let v = 0;
  for (const c of data) {
    t += mean(c.candidate) - mean(c.base);
    v += variance(c.candidate) / c.candidate.length + variance(c.base) / c.base.length;
  }
  return v === 0 ? (t < 0 ? 0 : 1) : pnorm(t / Math.sqrt(v));
}

/** Must fail at one trial per case: the paired t-test on per-case differences, normal approximation. */
function pairedT(data: CaseScores[]): number {
  const d = data.map((c) => mean(c.candidate) - mean(c.base));
  const sd = Math.sqrt(variance(d));
  const m = mean(d);
  return sd === 0 ? (m < 0 ? 0 : 1) : pnorm(m / (sd / Math.sqrt(d.length)));
}

/** Must fail: a proportion's items as independent binary trials, through the exact binary test. */
function binaryItems(data: CaseScores[], items: number): number {
  const counts = (vs: readonly number[]): { successes: number; trials: number } => ({
    successes: vs.reduce((a, v) => a + Math.round(v * items), 0),
    trials: vs.length * items,
  });
  return exactStratifiedTest(
    data.map((c) => ({ candidate: counts(c.candidate), base: counts(c.base) })),
    "less",
  ).p;
}

/** Reported only: arm labels permuted across all trials of all cases. */
function crossCase(data: CaseScores[], rng: Rng): number {
  const pool = data.flatMap((c) => [...c.candidate, ...c.base]);
  const statistic = (values: readonly number[]): number => {
    let at = 0;
    let t = 0;
    for (const c of data) {
      t += mean(values.slice(at, at + c.candidate.length));
      at += c.candidate.length;
      t -= mean(values.slice(at, at + c.base.length));
      at += c.base.length;
    }
    return t;
  };
  const observed = statistic(pool);
  const shuffled = [...pool];
  let count = 0;
  for (let b = 0; b < STUDY_RESAMPLES; b++) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng.uniform() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j] as number, shuffled[i] as number];
    }
    if (statistic(shuffled) <= observed + 1e-9) count++;
  }
  return (1 + count) / (1 + STUDY_RESAMPLES);
}

// --- Points ---------------------------------------------------------------------------------------

/**
 * What a point's result means. `type-I`: in the domain, must pass. `reported`: outside the domain
 * or a variant that is reported, not adopted. `must-fail`: must fail, so the harness is shown to
 * catch it.
 */
export type Role = "type-I" | "reported" | "must-fail";

export interface Point {
  readonly id: string;
  /**
   * Generator number g of the seed rule: 1–7 the generators, 8 the must-fails, 9 the imputation,
   * 10 the reported cross-case test, 11 the reported Holm simulation.
   */
  readonly generator: number;
  readonly family: string;
  readonly role: Role;
  readonly shape: Shape;
  readonly params: Readonly<Record<string, number | string>>;
  readonly seed: number;
  readonly confirmSeed: number;
  readonly recheckSeed: number;
  readonly test: TestName;
  /** One data set, after any missing trials are filled. */
  readonly draw: (rng: Rng) => CaseScores[];
  /** Whether the shipped test re-checks a point that is confirmed or fails. */
  readonly recheck: boolean;
  /**
   * Screening repetitions at the study's 6,000, when the point needs another number; they scale
   * with the screen's repetitions, so a smoke run stays small. Such a point is never confirmed.
   */
  readonly reps?: number;
}

/** A unit of work: one cell. A G2 cell holds its random structures and their refinement. */
export interface Cell {
  readonly id: string;
  readonly points: readonly Point[];
  /** G2 random structures only: the seed of the stream that draws the structures and perturbs them. */
  readonly structureSeed?: number;
  /**
   * G2 random structures only: one refinement step, a perturbation of `from` from the cell's
   * structure stream, as point s; undefined when the perturbation leaves [0.01, 0.99].
   */
  readonly refine?: (from: Point, s: number) => Point | undefined;
}

export function runTest(point: Point, data: CaseScores[], rng: Rng): number {
  switch (point.test) {
    case "permutation":
      return permutation(data, rng);
    case "replicate-strata":
      return replicateStrata(data, rng);
    case "wald":
      return wald(data);
    case "paired-t":
      return pairedT(data);
    case "binary-items":
      return binaryItems(data, point.params["items"] as number);
    case "cross-case":
      return crossCase(data, rng);
    case "holm":
      throw new Error("the Holm simulation has no single p-value");
  }
}

/**
 * The shipped test, as a decision runs it: exact when its work allows, else 10,000 resamples with
 * the rerun near each level. Its seed comes from the study's stream, so every repetition has its own.
 */
export const shippedTest = (data: CaseScores[], rng: Rng): ScorePermutationResult =>
  scorePermutationTest(data, {
    seed: 1 + Math.floor(rng.uniform() * 4_294_967_295),
    levels: LEVELS,
  });

/** The Holm simulation's primary measures: case IDs of measure j start with `m<j>/`. */
export const HOLM_MEASURES = 4;
/** Screening repetitions of a Holm point at the study's 6,000. */
export const HOLM_REPS = 20_000;

/**
 * Holm across the primary measures, with the shipped test on each. At family level α Holm rejects
 * any measure exactly when the smallest p-value is at most α/m, so the familywise rejection at each
 * level of LEVELS is min p ≤ level/m. `measures` holds each measure's own rejection at 0.05.
 */
export function holm(data: CaseScores[], rng: Rng): { levels: boolean[]; measures: boolean[] } {
  const ps = Array.from(
    { length: HOLM_MEASURES },
    (_, j) =>
      shippedTest(
        data.filter((c) => c.id.startsWith(`m${j}/`)),
        rng,
      ).p,
  );
  const smallest = Math.min(...ps);
  return {
    levels: LEVELS.map((level) => smallest <= level / HOLM_MEASURES),
    measures: ps.map((p) => p <= ALPHA),
  };
}

/** One repetition's rejections at each level, and, for the Holm simulation, per measure. */
export function rejections(
  point: Point,
  data: CaseScores[],
  rng: Rng,
): { levels: boolean[]; measures?: boolean[] } {
  if (point.test === "holm") return holm(data, rng);
  const p = runTest(point, data, rng);
  return { levels: LEVELS.map((level) => studyRejects(p, level)) };
}

export const shapeId = (s: Shape): string => `k${s.k}-${s.pattern}`;

/** The seeds of cell c of generator g (not G2): screen, confirmation and re-check. */
export function nonG2Seeds(
  g: number,
  c: number,
): { seed: number; confirmSeed: number; recheckSeed: number } {
  if (!(Number.isInteger(c) && c >= 0 && c < 1_000))
    throw new RangeError(`generator ${g} has more than 1,000 cells`);
  return {
    seed: 2_000_000 + 1_000 * g + c,
    confirmSeed: 3_000_000 + 1_000 * g + c,
    recheckSeed: 4_000_000 + 1_000 * g + c,
  };
}

/**
 * The seeds of structure s of G2 cell c′. c′ < 1,000 keeps the structure stream 2,002,000 + c′
 * below generator 3's seeds and every range below the next base; s < 1,000 keeps one cell's range
 * from reaching the next.
 */
export function g2Seeds(
  cPrime: number,
  s: number,
): { seed: number; confirmSeed: number; recheckSeed: number } {
  if (!(Number.isInteger(cPrime) && cPrime >= 0 && cPrime < 1_000))
    throw new RangeError("G2 has more than 1,000 cells");
  if (!(Number.isInteger(s) && s >= 0 && s < 1_000))
    throw new RangeError("a G2 cell has more than 1,000 structures");
  return {
    seed: 10_000_000 + 1_000 * cPrime + s,
    confirmSeed: 20_000_000 + 1_000 * cPrime + s,
    recheckSeed: 25_000_000 + 1_000 * cPrime + s,
  };
}

function simple(
  g: number,
  c: number,
  family: string,
  role: Role,
  shape: Shape,
  params: Record<string, number | string>,
  test: TestName,
  draw: (rng: Rng) => CaseScores[],
  reps?: number,
): Cell {
  const point: Point = {
    id: `G${g}/${family}/${shapeId(shape)}`,
    generator: g,
    family,
    role,
    shape,
    params,
    ...nonG2Seeds(g, c),
    test,
    draw,
    recheck: test === "permutation",
    ...(reps === undefined ? {} : { reps }),
  };
  return { id: point.id, points: [point] };
}

/** Random structures per G2 cell. Refinement steps follow them, from s = G2_STRUCTURES. */
export const G2_STRUCTURES = 500;
/** Hill-climbing chains, one from each of the worst structures. */
export const G2_REFINE_WORST = 5;
export const G2_REFINE_ROUNDS = 4;
export const G2_REFINE_STEPS_PER_ROUND = 5;
/** Perturbations per chain: 4 rounds of 5 steps. Step t of chain h is s = 500 + 20·h + t. */
export const G2_REFINE_STEPS = G2_REFINE_ROUNDS * G2_REFINE_STEPS_PER_ROUND;

/**
 * G2, heterogeneous per-case effects with mean 0. Family "top": most cases at base 0.95 drop by
 * dᵢ, and 1–3 noisy cases rise to offset them. Family "floor" mirrors it: most cases at base 0.05
 * rise, and the noisy cases carry the drop, so the long tail is on the side the test looks at.
 */
export function g2Structure(rng: Rng, k: number, family: "top" | "floor"): Structure {
  for (;;) {
    const noisy = Math.min(k - 1, 1 + Math.floor(rng.uniform() * 3));
    const stable = k - noisy;
    const dMax = 0.01 + rng.uniform() * 0.19;
    const d = Array.from({ length: stable }, () => rng.uniform() * dMax);
    const offset = d.reduce((a, b) => a + b, 0) / noisy;
    const noisyBase = 0.1 + rng.uniform() * 0.8;
    const noisyCandidate = family === "top" ? noisyBase + offset : noisyBase - offset;
    if (noisyCandidate < 0.01 || noisyCandidate > 0.99) continue;
    return [
      ...d.map((di) =>
        family === "top" ? ([0.95, 0.95 - di] as const) : ([0.05, 0.05 + di] as const),
      ),
      ...Array.from({ length: noisy }, () => [noisyBase, noisyCandidate] as const),
    ];
  }
}

/** A refinement step: scale the stable effects and move the noisy base, keeping the mean at 0. */
export function perturb(rng: Rng, s: Structure, family: "top" | "floor"): Structure | undefined {
  const scale = 0.7 + rng.uniform() * 0.6;
  const shift = (rng.uniform() * 2 - 1) * 0.1;
  const noisy = s.filter(([b]) => b !== (family === "top" ? 0.95 : 0.05));
  const stable = s.filter(([b]) => b === (family === "top" ? 0.95 : 0.05));
  const d = stable.map(([b, c]) => Math.abs(c - b) * scale);
  if (d.some((x) => x > 0.94)) return undefined;
  const offset = d.reduce((a, b) => a + b, 0) / noisy.length;
  const base = clip((noisy[0] as readonly [number, number])[0] + shift, 0.1, 0.9);
  const candidate = family === "top" ? base + offset : base - offset;
  if (candidate < 0.01 || candidate > 0.99) return undefined;
  return [
    ...d.map((di) =>
      family === "top" ? ([0.95, 0.95 - di] as const) : ([0.05, 0.05 + di] as const),
    ),
    ...noisy.map(() => [base, candidate] as const),
  ];
}

export function structurePoint(
  cPrime: number,
  s: number,
  family: string,
  shape: Shape,
  nu: number,
  structure: Structure,
  role: Role = "type-I",
): Point {
  return {
    id: `G2/${family}-nu${nu}/${shapeId(shape)}/s${s}`,
    generator: 2,
    family: `${family}-nu${nu}`,
    role,
    shape,
    params: {
      nu,
      // The exact means: JSON keeps every double, so a point rebuilt from this draws as the
      // original does.
      structure: JSON.stringify(structure),
    },
    ...g2Seeds(cPrime, s),
    test: "permutation",
    draw: (rng) =>
      dataset(rng, shape, (r, i, arm) => {
        const [b, c] = structure[i] as readonly [number, number];
        return beta(r, arm === "base" ? b : c, nu);
      }),
    recheck: true,
  };
}

/** A G2 cell: G2_STRUCTURES random structures, and refinement around the worst. */
function g2Cell(
  index: number,
  family: "top" | "floor",
  nu: number,
  shape: Shape,
  role: Role,
): Cell {
  const structureSeed = 2_000_000 + 1_000 * 2 + index;
  const structures = createRng(structureSeed);
  const points = Array.from({ length: G2_STRUCTURES }, (_, s) =>
    structurePoint(index, s, family, shape, nu, g2Structure(structures, shape.k, family), role),
  );
  return {
    id: `G2/${family}-nu${nu}/${shapeId(shape)}`,
    points,
    structureSeed,
    refine: (from, s) => {
      if (s < G2_STRUCTURES || s >= G2_STRUCTURES + G2_REFINE_WORST * G2_REFINE_STEPS)
        throw new RangeError(`refinement step ${s} is outside the cell's refinement seeds`);
      const parsed = JSON.parse(from.params["structure"] as string) as [number, number][];
      const next = perturb(structures, parsed, family);
      return next === undefined
        ? undefined
        : structurePoint(index, s, family, shape, nu, next, role);
    },
  };
}

/** A fixed structure with heterogeneous effects of mean 0, for the must-fail and reported points. */
function oneNoisy(family: "top" | "floor", k: number, noisy: number, d: number): Structure {
  const off = ((k - noisy) * d) / noisy;
  return Array.from({ length: k }, (_, i) => {
    if (family === "top")
      return i < k - noisy
        ? ([0.95, 0.95 - d] as const)
        : ([0.5 - off / 2, 0.5 + off / 2] as const);
    return i < k - noisy ? ([0.05, 0.05 + d] as const) : ([0.5 + off / 2, 0.5 - off / 2] as const);
  });
}

const fromStructure =
  (shape: Shape, structure: Structure, nu: number) =>
  (rng: Rng): CaseScores[] =>
    dataset(rng, shape, (r, i, arm) => {
      const [b, c] = structure[i] as readonly [number, number];
      return beta(r, arm === "base" ? b : c, nu);
    });

/** Every cell of the study, in a fixed order. The order fixes the seeds, so it never changes. */
export function cells(): Cell[] {
  const out: Cell[] = [];
  const grid = [...DOMAIN_SHAPES, ...R1_SHAPES];
  let c = 0;
  // G1: exactness under the sharp null.
  for (const nu of [2, 10, 50])
    for (const shape of grid)
      out.push(
        simple(1, c++, `nu${nu}`, "type-I", shape, { nu }, "permutation", (rng) =>
          dataset(
            rng,
            shape,
            betaTrial(meanOf, () => nu),
          ),
        ),
      );

  // G2: heterogeneous effects with mean 0, random structures with refinement, and symmetric ±d.
  let cPrime = 0;
  for (const family of ["top", "floor"] as const)
    for (const nu of [2, 10])
      for (const shape of grid) out.push(g2Cell(cPrime++, family, nu, shape, "type-I"));
  for (const d of [0.05, 0.1, 0.2])
    for (const shape of grid) {
      const index = cPrime++;
      const levels = [0.2, 0.5, 0.8];
      const structure: Structure = Array.from({ length: shape.k }, (_, i) => {
        const b = levels[i % levels.length] as number;
        // Half the cases rise by d, half drop; with k odd, the last case does not move.
        const sign = 2 * i + 1 === shape.k ? 0 : i < Math.floor(shape.k / 2) ? 1 : -1;
        return [b, b + sign * d] as const;
      });
      const point = structurePoint(index, 0, `symmetric-d${d}`, shape, 10, structure);
      // A G2 cell's ID is its points' ID without "/s<n>", as pointById looks it up.
      out.push({ id: `G2/symmetric-d${d}-nu10/${shapeId(shape)}`, points: [point] });
    }
  // Reported only: one trial per case below the grid, where the sign flip fails.
  for (const nu of [1, 2])
    for (const shape of R1_REPORTED_SHAPES)
      out.push(g2Cell(cPrime++, "top", nu, shape, "reported"));

  // G3: different variances in the two arms at the same mean. Arm-unequal cells are reported.
  c = 0;
  for (const [nuC, nuB] of [
    [2, 50],
    [50, 2],
  ] as const)
    for (const shape of [...grid, ...UNEQUAL_SHAPES]) {
      const inDomain = !shape.pattern.startsWith("c");
      out.push(
        simple(
          3,
          c++,
          `nuC${nuC}-nuB${nuB}`,
          inDomain ? "type-I" : "reported",
          shape,
          { nuC, nuB },
          "permutation",
          (rng) =>
            dataset(
              rng,
              shape,
              betaTrial(meanOf, (arm) => (arm === "candidate" ? nuC : nuB)),
            ),
        ),
      );
    }

  // G4: run-level shocks, shared across arms (interleaved) or separate. The domain requires
  // interleaving, so separate shocks are reported, and so is the replicate as a stratum. At one
  // trial per case shared shocks count, and separate ones, which cannot be told apart from an
  // effect, are reported.
  c = 0;
  const shocks = [
    [0, true],
    [0.01, true],
    [0.02, true],
    [0.05, true],
    [0.1, true],
    [0.01, false],
    [0.02, false],
    [0.05, false],
    [0.1, false],
  ] as const;
  for (const [sigma, shared] of shocks)
    for (const shape of DOMAIN_SHAPES)
      for (const test of ["permutation", "replicate-strata"] as const) {
        const family = `sigma${sigma}-${shared ? "shared" : "separate"}${test === "permutation" ? "" : "-replicate-strata"}`;
        const role: Role = shared && test === "permutation" ? "type-I" : "reported";
        out.push(
          simple(4, c++, family, role, shape, { sigma, shared: String(shared) }, test, (rng) =>
            shocked(rng, shape, sigma, shared, 10),
          ),
        );
      }
  for (const [sigma] of shocks.filter(([, shared]) => shared))
    for (const shape of R1_SHAPES)
      out.push(
        simple(
          4,
          c++,
          `sigma${sigma}-shared`,
          "type-I",
          shape,
          { sigma, shared: "true" },
          "permutation",
          (rng) => shocked(rng, shape, sigma, true, 10),
        ),
      );
  for (const [sigma] of shocks.filter(([, shared]) => !shared))
    for (const shape of R1_SHAPES)
      out.push(
        simple(
          4,
          c++,
          `sigma${sigma}-separate`,
          "reported",
          shape,
          { sigma, shared: "false" },
          "permutation",
          (rng) => shocked(rng, shape, sigma, false, 10),
        ),
      );

  // G5: proportions, m items per output, beta-binomial with ICC rho.
  c = 0;
  for (const items of [3, 5, 10, 20])
    for (const rho of [0, 0.2, 0.5])
      for (const shape of grid)
        out.push(
          simple(
            5,
            c++,
            `m${items}-rho${rho}`,
            "type-I",
            shape,
            { items, rho },
            "permutation",
            (rng) => dataset(rng, shape, (r, i) => betaBinomial(r, items, meanOf(i), rho) / items),
          ),
        );

  // G6: a bimodal judge, 0 or 1 mostly, 0.5 with probability `half`.
  c = 0;
  for (const half of [0.1, 0.3])
    for (const shape of grid)
      out.push(
        simple(6, c++, `half${half}`, "type-I", shape, { half }, "permutation", (rng) =>
          dataset(rng, shape, (r, i) => {
            const u = r.uniform();
            return u < half ? 0.5 : r.uniform() < meanOf(i) ? 1 : 0;
          }),
        ),
      );

  // G7: 1–5 ratings from a latent normal, (s − 1) / 4.
  c = 0;
  for (const name of ["even", "skewed"] as const)
    for (const shape of grid)
      out.push(
        simple(
          7,
          c++,
          `thresholds-${name}`,
          "type-I",
          shape,
          { thresholds: name },
          "permutation",
          (rng) => dataset(rng, shape, (r, i) => likert(r, i, THRESHOLDS[name])),
        ),
      );

  // 8: must-fail checks. Each must fail, so the harness is shown to catch a failure.
  c = 0;
  for (const k of [12, 30, 60]) {
    const shape: Shape = { k, pattern: "r2" };
    out.push(
      simple(
        8,
        c++,
        "binary-items-m10-rho0.5",
        "must-fail",
        shape,
        { items: 10, rho: 0.5 },
        "binary-items",
        (rng) => dataset(rng, shape, (r, i) => betaBinomial(r, 10, meanOf(i), 0.5) / 10),
      ),
      simple(
        8,
        c++,
        "sigma0.15-separate",
        "must-fail",
        shape,
        { sigma: 0.15, shared: "false" },
        "permutation",
        (rng) => shocked(rng, shape, 0.15, false, 10),
      ),
    );
  }
  for (const [k, noisy, nu, d] of [
    [12, 1, 10, 0.05],
    [12, 2, 2, 0.08],
    [30, 1, 10, 0.03],
  ] as const) {
    const shape: Shape = { k, pattern: "r2" };
    out.push(
      simple(
        8,
        c++,
        `wald-floor-noisy${noisy}-nu${nu}-d${d}`,
        "must-fail",
        shape,
        { nu, d, noisy },
        "wald",
        fromStructure(shape, oneNoisy("floor", k, noisy, d), nu),
      ),
    );
  }
  {
    const shape: Shape = { k: 5, pattern: "r1" };
    out.push(
      simple(
        8,
        c++,
        "paired-t-top-noisy1-nu2-d0.08",
        "must-fail",
        shape,
        { nu: 2, d: 0.08, noisy: 1 },
        "paired-t",
        fromStructure(shape, oneNoisy("top", 5, 1, 0.08), 2),
      ),
    );
  }

  // 9: missing trials filled against a drop, at random or tied to the outcome, in either arm. At one
  // trial per case a missing trial unpairs its case instead, so this runs on the r ≥ 2 shapes only.
  c = 0;
  for (const base of ["G1-nu10", "G7-even"] as const)
    for (const mechanism of ["random", "tied"] as const)
      for (const shape of DOMAIN_SHAPES)
        out.push(
          simple(
            9,
            c++,
            `${base}-${mechanism}`,
            "type-I",
            shape,
            { mechanism },
            "permutation",
            (rng) =>
              base === "G1-nu10"
                ? imputed(
                    rng,
                    dataset(
                      rng,
                      shape,
                      betaTrial(meanOf, () => 10),
                    ),
                    meanOf,
                    mechanism,
                  )
                : imputed(
                    rng,
                    dataset(rng, shape, (r, i) => likert(r, i, THRESHOLDS.even)),
                    // The rating at the case's latent mean: a value below it is a low rating.
                    (i) =>
                      THRESHOLDS.even.filter(
                        (t) => t < (LATENT_MEANS[i % LATENT_MEANS.length] as number),
                      ).length / 4,
                    mechanism,
                  ),
          ),
        );

  // 10: reported, a permutation across cases under G2 (conservative there).
  c = 0;
  for (const k of [12, 30]) {
    const shape: Shape = { k, pattern: "r2" };
    out.push(
      simple(
        10,
        c++,
        "cross-case-top",
        "reported",
        shape,
        { noisy: 2 },
        "cross-case",
        fromStructure(shape, oneNoisy("top", k, 2, 0.05), 10),
      ),
    );
  }

  // 11: reported, Holm across four correlated primary measures with no change, the shipped test on
  // each. G2 structures: per trial a shared x ~ Beta(mean, ν), and each measure a Beta of mean x and
  // its own precision. G5: per trial a shared rate from the beta of ICC ρ, and each measure its own
  // binomial items at that rate.
  c = 0;
  for (const [family, nu, shape] of [
    ["top", 2, { k: 12, pattern: "r2" }],
    ["floor", 2, { k: 30, pattern: "r2" }],
    ["top", 10, { k: 17, pattern: "mixed" }],
  ] as const) {
    const structure = oneNoisy(family, shape.k, 2, 0.05);
    out.push(
      simple(
        11,
        c++,
        `holm-${family}-nu${nu}`,
        "reported",
        shape,
        { nu, measures: HOLM_MEASURES },
        "holm",
        (rng) =>
          correlated(rng, shape, (r, i, arm) => {
            const [b, cand] = structure[i] as readonly [number, number];
            const x = beta(r, arm === "base" ? b : cand, nu);
            return (j) => beta(r, x, HOLM_PRECISIONS[j] as number);
          }),
        HOLM_REPS,
      ),
    );
  }
  for (const [items, rho, shape] of [
    [3, 0.5, { k: 12, pattern: "r2" }],
    [5, 0.2, { k: 30, pattern: "mixed" }],
    [10, 0.5, { k: 60, pattern: "r3" }],
  ] as const)
    out.push(
      simple(
        11,
        c++,
        `holm-m${items}-rho${rho}`,
        "reported",
        shape,
        { items, rho, measures: HOLM_MEASURES },
        "holm",
        (rng) =>
          correlated(rng, shape, (r, i) => {
            const p = beta(r, meanOf(i), (1 - rho) / rho);
            return () => {
              let passed = 0;
              for (let n = 0; n < items; n++) if (r.uniform() < p) passed++;
              return passed / items;
            };
          }),
        HOLM_REPS,
      ),
    );
  return out;
}

/** The Holm simulation's precision of each measure around the shared G2 draw. */
const HOLM_PRECISIONS = [2, 5, 10, 50] as const;

/**
 * HOLM_MEASURES measures of one data set: `trial` draws a trial's shared part and returns each
 * measure's value given it. Measure j's cases have IDs `m<j>/c<i>`.
 */
function correlated(
  rng: Rng,
  shape: Shape,
  trial: (rng: Rng, i: number, arm: "candidate" | "base") => (j: number) => number,
): CaseScores[] {
  const cases = Array.from({ length: shape.k }, (_, i) => {
    const [nc, nb] = trialsOf(shape, i);
    const arm = (a: "candidate" | "base", n: number): number[][] =>
      Array.from({ length: n }, () => {
        const value = trial(rng, i, a);
        return Array.from({ length: HOLM_MEASURES }, (_unused, j) => value(j));
      });
    return { candidate: arm("candidate", nc), base: arm("base", nb) };
  });
  return Array.from({ length: HOLM_MEASURES }, (_, j) =>
    cases.map((c, i) => ({
      id: `m${j}/c${i}`,
      candidate: c.candidate.map((v) => v[j] as number),
      base: c.base.map((v) => v[j] as number),
    })),
  ).flat();
}

/** Relative cost of a cell: repetitions scale with points, trials and resamples. */
export function costOf(cell: Cell): number {
  const first = cell.points[0] as Point;
  const shape = first.shape;
  const trials = Array.from({ length: shape.k }, (_, i) => trialsOf(shape, i)).reduce(
    (a, [x, y]) => a + x + y,
    0,
  );
  const points = cell.points.length + (cell.refine ? G2_REFINE_WORST * G2_REFINE_STEPS : 0);
  // A Holm point runs the shipped test (10,000 resamples against the study's 239) on each
  // measure, at more repetitions.
  const perPoint =
    first.test === "holm" ? (HOLM_MEASURES * trials * 10_000) / STUDY_RESAMPLES : trials + 10;
  return points * perPoint * ((first.reps ?? 6_000) / 6_000);
}

/** Cells of shard `index` of `count`: longest processing time first, ties by cell order. */
export function shardOf(all: readonly Cell[], index: number, count: number): Cell[] {
  const load = Array.from({ length: count }, () => 0);
  const owner = new Map<string, number>();
  const order = all
    .map((cell, i) => ({ cell, i, cost: costOf(cell) }))
    .toSorted((a, b) => b.cost - a.cost || a.i - b.i);
  for (const { cell, cost } of order) {
    let best = 0;
    for (let s = 1; s < count; s++) if ((load[s] as number) < (load[best] as number)) best = s;
    load[best] = (load[best] as number) + cost;
    owner.set(cell.id, best);
  }
  return all.filter((cell) => owner.get(cell.id) === index);
}

/**
 * A point of a screened cell, by id: a grid point, or a G2 refinement step rebuilt from its stored
 * structure. The re-check uses it, because refinement steps exist only in the screening output.
 */
export function pointById(
  byCell: ReadonlyMap<string, Cell>,
  id: string,
  structure: string | undefined,
): Point {
  const s = /^(G2\/[^/]+\/[^/]+)\/s(\d+)$/.exec(id);
  const cell = byCell.get(s ? (s[1] as string) : id);
  if (cell === undefined) throw new Error(`no cell for point ${id}`);
  const known = cell.points.find((x) => x.id === id);
  if (known !== undefined) return known;
  if (!s || structure === undefined) throw new Error(`no point ${id}`);
  const first = cell.points[0] as Point;
  const cPrime = (first.seed - 10_000_000) / 1_000;
  const family = first.family.replace(/-nu[\d.]+$/, "");
  return structurePoint(
    cPrime,
    Number(s[2]),
    family,
    first.shape,
    first.params["nu"] as number,
    JSON.parse(structure) as [number, number][],
    first.role,
  );
}
