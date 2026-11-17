// The points of stage 1 of the score non-inferiority study (VALIDATION.md, "Score measures:
// non-inferiority"): every generator, grid shape, margin, truth and seed, fixed before any run.
// Each repetition draws one data set and evaluates every method setting on it: the event is "the
// one-sided 95% lower bound is at most −margin". At truth −margin its rate is the coverage; at
// truth 0 its complement is π₀, the chance of showing non-inferiority when nothing changed.
import { pnorm } from "../../src/stats/normal.ts";
import { createRng, type Rng } from "../../src/stats/rng.ts";
import {
  boundSC,
  pooledDispersion,
  pooledDispersionUncorrected,
  scoreStatistic,
  scoreTarget,
} from "../../src/stats/score-interval.ts";
import { lowerRootAtMost } from "../../src/stats/solve.ts";
import type { CaseScores } from "../../src/stats/score-permutation-core.ts";
import {
  beta,
  betaBinomial,
  dataset,
  DOMAIN_SHAPES,
  g2Structure,
  LATENT_MEANS,
  meanOf,
  normal,
  perturb,
  type Shape,
  shapeId,
  type Structure,
  THRESHOLDS,
  trialsOf,
} from "./score-type-i-points.ts";

export const LEVEL = 0.95;

/** Effective margins from 0.05 to 0.30 in steps of 0.005. */
export const MARGINS: readonly number[] = Array.from(
  { length: 51 },
  (_, i) => Math.round(50 + 5 * i) / 1000,
);
/** The grid: k from 12, 2 or 3 trials, mixed, and up to 10% one-trial cells. */
export const NI_SHAPES: readonly Shape[] = DOMAIN_SHAPES.filter((s) => s.k >= 12);

// --- Method settings -------------------------------------------------------------------------------

/** What a setting's result means for the choice of method. */
export type SettingRole = "candidate" | "must-fail" | "reported";

export interface Setting {
  readonly name: string;
  readonly role: SettingRole;
  /** The variance scale φ of a score bound, or "t" for S-C. */
  readonly phi: ((cases: readonly CaseScores[]) => number) | "t";
}

const FLOORS = [0, 0.01, 0.02, 0.05, 0.1] as const;
export const SETTINGS: readonly Setting[] = [
  { name: "S-A", role: "candidate", phi: () => 1 },
  ...FLOORS.map((f): Setting => ({
    name: `S-B phi_min ${f}`,
    role: f === 0 ? "must-fail" : "candidate",
    phi: (cases) => Math.max(pooledDispersion(cases), f),
  })),
  ...FLOORS.map((f): Setting => ({
    name: `S-B uncorrected phi_min ${f}`,
    role: "reported",
    phi: (cases) => Math.max(pooledDispersionUncorrected(cases), f),
  })),
  { name: "S-C", role: "candidate", phi: "t" },
];

/**
 * For every setting, whether its lower bound is at most −margin, decided on the root-finder's own
 * path (`lowerRootAtMost`) without computing the whole root. Every score setting inverts the same
 * Z₁ at its own target z·√φ, so one cached Z₁ per data set serves them all with the same
 * floating-point values as the shipped bound. An unavailable bound (S-C without residual degrees
 * of freedom) makes no claim, so it counts as covered.
 */
export function events(cases: readonly CaseScores[], margin: number): boolean[] {
  const z1 = scoreStatistic(cases);
  const cache = new Map<number, number>();
  const cached = (delta: number): number => {
    let v = cache.get(delta);
    if (v === undefined) {
      v = z1(delta);
      cache.set(delta, v);
    }
    return v;
  };
  const byPhi = new Map<number, boolean>();
  return SETTINGS.map((s) => {
    if (s.phi === "t") {
      const bound = boundSC(cases, LEVEL);
      return bound === null || bound <= -margin;
    }
    const phi = s.phi(cases);
    let event = byPhi.get(phi);
    if (event === undefined) {
      event = lowerRootAtMost(cached, scoreTarget(LEVEL, phi), -1, 1, -margin);
      byPhi.set(phi, event);
    }
    return event;
  });
}

// --- Truths -----------------------------------------------------------------------------------------

const clip = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
/** The standard normal density. */
const dnorm = (x: number): number => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

/** Every truth is exact to this. */
export const TRUTH_TOLERANCE = 1e-9;

/** Bisection for the x in [lo, hi] with f(x) = target, f increasing. */
function solveIncreasing(f: (x: number) => number, target: number, lo: number, hi: number): number {
  let a = lo;
  let b = hi;
  for (let i = 0; i < 300 && b - a > 1e-15; i++) {
    const mid = (a + b) / 2;
    if (f(mid) < target) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}

/**
 * Candidate parameters for an exact mean difference of −margin: θ_Cᵢ = θ_Bᵢ − c·(θ_Bᵢ − lo), one c
 * in (0, 1] for the structure. `expect` maps a case's parameter to its exact expected value; the
 * truth Σᵢ (expect(θ_Cᵢ) − expect(θ_Bᵢ)) / k decreases in c, so c comes from a bisection (or in
 * closed form when `expect` is the identity). Undefined when even c = 1 cannot reach the margin:
 * the point is skipped and counted.
 */
export function shiftedByRoom(
  base: readonly number[],
  lo: number,
  margin: number,
  expect: (theta: number, i: number) => number = (theta) => theta,
): number[] | undefined {
  const k = base.length;
  const truthAt = (c: number): number =>
    base.reduce((a, b, i) => a + expect(b - c * (b - lo), i) - expect(b, i), 0) / k;
  if (truthAt(1) > -margin + TRUTH_TOLERANCE / 10) return undefined;
  const c = solveIncreasing((x) => -truthAt(x), margin, 0, 1);
  const cand = base.map((b) => b - c * (b - lo));
  if (Math.abs(truthAt(c) + margin) > TRUTH_TOLERANCE)
    throw new Error(`truth ${truthAt(c)} is not −${margin} within ${TRUTH_TOLERANCE}`);
  return cand;
}

/**
 * E[clip(μ + u, 0.01, 0.99)] for a shock u ~ N(0, σ²): the exact mean of a G4 trial, whose Beta
 * mean is the clipped, shocked case mean.
 */
export function clippedShockMean(mu: number, sigma: number): number {
  const lo = 0.01;
  const hi = 0.99;
  if (sigma === 0) return clip(mu, lo, hi);
  const a = (lo - mu) / sigma;
  const b = (hi - mu) / sigma;
  return (
    mu * (pnorm(b) - pnorm(a)) + sigma * (dnorm(a) - dnorm(b)) + lo * pnorm(a) + hi * (1 - pnorm(b))
  );
}

/** E[Y] of a 1–5 rating, (s − 1)/4, from a latent N(mu, 1) and thresholds: exact. */
export const likertMean = (mu: number, thresholds: readonly number[]): number =>
  thresholds.reduce((a, t) => a + (1 - pnorm(t - mu)), 0) / thresholds.length;

function likertAt(rng: Rng, mu: number, thresholds: readonly number[]): number {
  const z = mu + normal(rng);
  return thresholds.filter((t) => t < z).length / 4;
}

/**
 * G7: one latent shift s ≥ 0 for every case's candidate, with the exact rating means averaging
 * −margin below the base's. Undefined when the margin exceeds the base's mean rating.
 */
export function likertShift(
  latent: readonly number[],
  thresholds: readonly number[],
  margin: number,
): number | undefined {
  const k = latent.length;
  const baseMean = latent.reduce((a, l) => a + likertMean(l, thresholds), 0) / k;
  if (margin >= baseMean) return undefined;
  const drop = (s: number): number =>
    baseMean - latent.reduce((a, l) => a + likertMean(l - s, thresholds), 0) / k;
  let hi = 1;
  while (drop(hi) < margin) hi *= 2;
  const s = solveIncreasing(drop, margin, 0, hi);
  if (Math.abs(drop(s) - margin) > TRUTH_TOLERANCE)
    throw new Error(`G7 truth ${-drop(s)} is not −${margin} within ${TRUTH_TOLERANCE}`);
  return s;
}

// --- Points -----------------------------------------------------------------------------------------

export interface NiPoint {
  readonly id: string;
  readonly generator: number;
  readonly family: string;
  readonly shape: Shape;
  readonly margin: number;
  /** "margin": truth −margin, where coverage decides; "zero": truth 0, π₀, reported. */
  readonly truth: "margin" | "zero";
  readonly params: Readonly<Record<string, number | string>>;
  readonly seed: number;
  readonly confirmSeed: number;
  readonly draw: (rng: Rng) => CaseScores[];
}

export interface NiCell {
  readonly id: string;
  readonly points: readonly NiPoint[];
  /** G2 only: the refinement around the worst structures, which needs the screened cell. */
  readonly refine?: (worst: readonly NiPoint[], count: number) => NiPoint[];
  /** Structures or points that could not reach the truth: skipped and counted. */
  readonly skipped?: number;
  /** G2 only: the cell index c′ of the seed rule, which also names the structure stream. */
  readonly cellIndex?: number;
}

/** Seed stride per generator: a generator has more than 1,000 points here, so 100,000. */
const STRIDE = 100_000;
const marginId = (m: number): string => m.toFixed(3);

/**
 * A non-G2 generator. Each case has a parameter θ (a mean, or G7's latent mean) with an exact
 * expected value; `lo` is the lowest parameter the generator can reach; `draw` samples a data set
 * from the candidate's and the base's parameters.
 */
interface MeanGenerator {
  readonly family: string;
  readonly params: Record<string, number | string>;
  readonly base: (i: number) => number;
  readonly lo: number;
  readonly expect: (theta: number, i: number) => number;
  /** G7 only: the candidate's parameters for a margin, by one latent shift. */
  readonly shift?: (base: readonly number[], margin: number) => number[] | undefined;
  readonly draw: (
    rng: Rng,
    shape: Shape,
    cand: readonly number[],
    base: readonly number[],
  ) => CaseScores[];
}

const identity = (theta: number): number => theta;

const betaDraw =
  (nuC: number, nuB: number) =>
  (rng: Rng, shape: Shape, cand: readonly number[], base: readonly number[]): CaseScores[] =>
    dataset(rng, shape, (r, i, arm) =>
      beta(
        r,
        arm === "base" ? (base[i] as number) : (cand[i] as number),
        arm === "base" ? nuB : nuC,
      ),
    );

function meanGenerators(): { g: number; gens: MeanGenerator[] }[] {
  return [
    {
      g: 1,
      gens: [2, 10, 50].map((nu) => ({
        family: `nu${nu}`,
        params: { nu },
        base: meanOf,
        lo: 0.01,
        expect: identity,
        draw: betaDraw(nu, nu),
      })),
    },
    {
      g: 3,
      gens: (
        [
          [2, 50],
          [50, 2],
        ] as const
      ).map(([nuC, nuB]) => ({
        family: `nuC${nuC}-nuB${nuB}`,
        params: { nuC, nuB },
        base: meanOf,
        lo: 0.01,
        expect: identity,
        draw: betaDraw(nuC, nuB),
      })),
    },
    {
      g: 4,
      gens: [0, 0.01, 0.02, 0.05, 0.1].map((sigma) => ({
        family: `sigma${sigma}-shared`,
        params: { sigma, shared: "true" },
        base: meanOf,
        lo: 0.01,
        // The trial's Beta mean is the clipped, shocked case mean, so its exact mean is this.
        expect: (theta: number) => clippedShockMean(theta, sigma),
        draw: (rng: Rng, shape: Shape, cand: readonly number[], base: readonly number[]) => {
          const shock = Array.from({ length: 3 }, () => sigma * normal(rng));
          return dataset(rng, shape, (r, i, arm, j) => {
            const mu = arm === "base" ? (base[i] as number) : (cand[i] as number);
            return beta(r, clip(mu + (shock[j] as number), 0.01, 0.99), 10);
          });
        },
      })),
    },
    {
      g: 5,
      gens: [3, 5, 10, 20].flatMap((items) =>
        [0, 0.2, 0.5].map((rho) => ({
          family: `m${items}-rho${rho}`,
          params: { items, rho },
          base: meanOf,
          lo: 0.01,
          expect: identity,
          draw: (rng: Rng, shape: Shape, cand: readonly number[], base: readonly number[]) =>
            dataset(
              rng,
              shape,
              (r, i, arm) =>
                betaBinomial(
                  r,
                  items,
                  arm === "base" ? (base[i] as number) : (cand[i] as number),
                  rho,
                ) / items,
            ),
        })),
      ),
    },
    {
      g: 6,
      gens: [0.1, 0.3].map((half) => ({
        family: `half${half}`,
        params: { half },
        // Mean = half/2 + (1 − half)·b, with b the chance of 1 among the other values; at b = 0
        // the mean is half/2, the lowest this generator reaches.
        base: (i: number) => 0.5 * half + (1 - half) * meanOf(i),
        lo: 0.5 * half,
        expect: identity,
        draw: (rng: Rng, shape: Shape, cand: readonly number[], base: readonly number[]) =>
          dataset(rng, shape, (r, i, arm) => {
            const target = arm === "base" ? (base[i] as number) : (cand[i] as number);
            const b = clip((target - 0.5 * half) / (1 - half), 0, 1);
            return r.uniform() < half ? 0.5 : r.uniform() < b ? 1 : 0;
          }),
      })),
    },
    {
      g: 7,
      gens: (["even", "skewed"] as const).map((name) => {
        const thresholds = THRESHOLDS[name];
        return {
          family: `thresholds-${name}`,
          params: { thresholds: name },
          // The parameter is the latent mean; its rating mean is exact through the normal CDF.
          base: (i: number) => LATENT_MEANS[i % LATENT_MEANS.length] as number,
          lo: Number.NEGATIVE_INFINITY,
          expect: (theta: number) => likertMean(theta, thresholds),
          shift: (base: readonly number[], margin: number) => {
            const s = likertShift(base, thresholds, margin);
            return s === undefined ? undefined : base.map((l) => l - s);
          },
          draw: (rng: Rng, shape: Shape, cand: readonly number[], base: readonly number[]) =>
            dataset(rng, shape, (r, i, arm) =>
              likertAt(r, (arm === "base" ? base[i] : cand[i]) as number, thresholds),
            ),
        };
      }),
    },
  ];
}

/** G2 for stage 1: the first structures of each (variant, shape, margin) stream, and refinement. */
export const G2_NI_STRUCTURES = 100;
export const G2_NI_REFINE_WORST = 5;
export const G2_NI_REFINE_STEPS = 4;
/** Largest G2 cell index: 50,000,000 + 1,000·c′ + s then stays below the confirmation base. */
const MAX_G2_CELLS = 10_000;

/**
 * A mean-0 G2 structure moved to a mean difference of exactly −margin, as the binary floor sweep moves its structures: the stable
 * cases' effects are scaled by one factor a ≥ 0 with the noisy cases unchanged; when no a keeps
 * every rate in [0.01, 0.99], a takes its nearest feasible value and the last noisy case's
 * candidate rate absorbs the rest. Undefined, and so skipped and counted, when that leaves the
 * range too.
 */
export function toMargin(
  s: Structure,
  family: "top" | "floor",
  margin: number,
): Structure | undefined {
  const k = s.length;
  const edge = family === "top" ? 0.95 : 0.05;
  const stable = s.map(([b]) => b === edge);
  const effect = s.map(([b, c]) => c - b);
  const stableSum = effect.reduce((a, e, i) => a + (stable[i] ? e : 0), 0);
  const noisySum = effect.reduce((a, e, i) => a + (stable[i] ? 0 : e), 0);
  const target = -k * margin;
  // Feasible scale factors: every stable candidate rate edge + a·e in [0.01, 0.99].
  let aMax = Number.POSITIVE_INFINITY;
  for (let i = 0; i < k; i++)
    if (stable[i] && (effect[i] as number) !== 0) {
      const e = effect[i] as number;
      aMax = Math.min(aMax, e < 0 ? (0.01 - edge) / e : (0.99 - edge) / e);
    }
  const wanted = stableSum === 0 ? 0 : (target - noisySum) / stableSum;
  const a = clip(wanted, 0, aMax);
  const last = stable.findLastIndex((x) => !x);
  if (last < 0) return undefined;
  const out = s.map(
    ([b, c], i) => [b, stable[i] ? b + a * (effect[i] as number) : c] as [number, number],
  );
  const total = out.reduce((acc, [b, c]) => acc + c - b, 0);
  const [lastBase, lastCand] = out[last] as [number, number];
  const moved = lastCand + (target - total);
  if (!(moved >= 0.01 && moved <= 0.99)) return undefined;
  out[last] = [lastBase, moved];
  const truth = out.reduce((acc, [b, c]) => acc + c - b, 0) / k;
  if (Math.abs(truth + margin) > TRUTH_TOLERANCE)
    throw new Error(`G2 truth ${truth} is not −${margin} within ${TRUTH_TOLERANCE}`);
  return out;
}

function g2Point(
  cPrime: number,
  s: number,
  variant: { family: "top" | "floor"; nu: number },
  shape: Shape,
  margin: number,
  structure: Structure,
  meanZero: Structure,
): NiPoint {
  if (s >= 1000) throw new RangeError("a G2 cell has more than 1,000 structures");
  if (cPrime >= MAX_G2_CELLS) throw new RangeError(`more than ${MAX_G2_CELLS} G2 cells`);
  return {
    id: `G2/${variant.family}-nu${variant.nu}/${shapeId(shape)}/m${marginId(margin)}/s${s}`,
    generator: 2,
    family: `${variant.family}-nu${variant.nu}`,
    shape,
    margin,
    truth: "margin",
    // The mean-0 shape too: refinement perturbs it, then moves it to the margin again.
    params: {
      nu: variant.nu,
      structure: JSON.stringify(structure),
      shape: JSON.stringify(meanZero),
    },
    seed: 50_000_000 + 1_000 * cPrime + s,
    confirmSeed: 60_000_000 + 1_000 * cPrime + s,
    draw: (rng) =>
      dataset(rng, shape, (r, i, arm) => {
        const [b, c] = structure[i] as readonly [number, number];
        return beta(r, arm === "base" ? b : c, variant.nu);
      }),
  };
}

// --- The concentrated family ------------------------------------------------------------------------

/**
 * The concentrated family's shape before it meets a margin: a low-variance majority (ν = 50) with
 * mid-range base means, and 1–3 noisy cases (ν = 2) that start high and end near the floor.
 */
interface ConcentratedShape {
  readonly majority: readonly number[];
  readonly noisy: readonly { readonly base: number; readonly u: number }[];
}

const MAJORITY_BASES = [0.2, 0.5, 0.8] as const;
const NOISY_BASES = [0.8, 0.95] as const;
const MU_LO = 0.01;
const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng.uniform() * xs.length)] as T;

function concentratedShape(rng: Rng, k: number): ConcentratedShape {
  const n = Math.min(k - 1, 1 + Math.floor(rng.uniform() * 3));
  return {
    majority: Array.from({ length: k - n }, () => pick(rng, MAJORITY_BASES)),
    noisy: Array.from({ length: n }, () => ({
      base: pick(rng, NOISY_BASES),
      u: rng.uniform() * 0.05,
    })),
  };
}

/** A refinement step: move each noisy case's end a little and redraw a few majority bases. */
function perturbConcentrated(rng: Rng, shape: ConcentratedShape): ConcentratedShape {
  return {
    majority: shape.majority.map((b) => (rng.uniform() < 0.2 ? pick(rng, MAJORITY_BASES) : b)),
    noisy: shape.noisy.map(({ base, u }) => ({
      base,
      u: clip(u + (rng.uniform() - 0.5) * 0.02, 0, 0.05),
    })),
  };
}

/**
 * The concentrated shape at an exact mean difference of −margin: the noisy cases end
 * at μ_lo + u, and the majority shifts by one c ∈ [−1, 1] in proportion to its room. For c ≥ 0 each
 * majority mean drops by c·(b − μ_lo); for c < 0 it rises by |c|·(0.99 − b), when the noisy cases
 * already carry more than the margin. The truth is linear in c on each side, so c has a closed
 * form. Rows are [base, candidate, ν]. Undefined, skipped and counted, when |c| would exceed 1.
 */
export function concentratedAtMargin(
  shape: ConcentratedShape,
  margin: number,
): { rows: (readonly [number, number, number])[]; c: number; noisyShare: number } | undefined {
  const k = shape.majority.length + shape.noisy.length;
  const noisyEffect = shape.noisy.reduce((a, { base, u }) => a + MU_LO + u - base, 0);
  // The majority's total effect that makes the mean −margin.
  const needed = -k * margin - noisyEffect;
  const roomDown = shape.majority.reduce((a, b) => a + b - MU_LO, 0);
  const roomUp = shape.majority.reduce((a, b) => a + 0.99 - b, 0);
  const c = needed <= 0 ? -needed / roomDown : -needed / roomUp;
  if (!(Math.abs(c) <= 1)) return undefined;
  const rows: (readonly [number, number, number])[] = [
    ...shape.majority.map(
      (b) => [b, c >= 0 ? b - c * (b - MU_LO) : b - c * (0.99 - b), 50] as const,
    ),
    ...shape.noisy.map(({ base, u }) => [base, MU_LO + u, 2] as const),
  ];
  if (rows.some(([, x]) => !(x >= MU_LO - 1e-15 && x <= 0.99 + 1e-15)))
    throw new Error("a concentrated mean left [μ_lo, 0.99]");
  const truth = rows.reduce((a, [b, x]) => a + x - b, 0) / k;
  if (Math.abs(truth + margin) > TRUTH_TOLERANCE)
    throw new Error(`concentrated truth ${truth} is not −${margin} within ${TRUTH_TOLERANCE}`);
  // The share of the mean drop that the noisy cases carry: above 1 when the majority rises.
  return { rows, c, noisyShare: noisyEffect / (-k * margin) };
}

function concentratedPoint(
  cPrime: number,
  s: number,
  shape: Shape,
  margin: number,
  at: { rows: readonly (readonly [number, number, number])[]; c: number; noisyShare: number },
  spec: ConcentratedShape,
): NiPoint {
  const { rows } = at;
  if (s >= 1000) throw new RangeError("a G2 cell has more than 1,000 structures");
  if (cPrime >= MAX_G2_CELLS) throw new RangeError(`more than ${MAX_G2_CELLS} G2 cells`);
  return {
    id: `G2/concentrated/${shapeId(shape)}/m${marginId(margin)}/s${s}`,
    generator: 2,
    family: "concentrated",
    shape,
    margin,
    truth: "margin",
    params: {
      nu: "50 and 2",
      structure: JSON.stringify(rows),
      shape: JSON.stringify(spec),
      c: at.c,
      noisyShare: at.noisyShare,
    },
    seed: 50_000_000 + 1_000 * cPrime + s,
    confirmSeed: 60_000_000 + 1_000 * cPrime + s,
    draw: (rng) =>
      dataset(rng, shape, (r, i, arm) => {
        const [b, c, nu] = rows[i] as readonly [number, number, number];
        return beta(r, arm === "base" ? b : c, nu);
      }),
  };
}

/** The structure stream of G2 cell c′: 30,000,000 + 100,000·2 + c′. */
const structureStream = (cPrime: number): Rng => createRng(30_000_000 + STRIDE * 2 + cPrime);

/** Every cell of stage 1, in a fixed order. The order fixes the seeds, so it never changes. */
export function niCells(): NiCell[] {
  const out: NiCell[] = [];
  for (const { g, gens } of meanGenerators()) {
    let c = 0;
    for (const gen of gens)
      for (const shape of NI_SHAPES) {
        const base = Array.from({ length: shape.k }, (_, i) => gen.base(i));
        for (const margin of MARGINS) {
          const atMargin = gen.shift
            ? gen.shift(base, margin)
            : shiftedByRoom(base, gen.lo, margin, gen.expect);
          for (const truth of ["margin", "zero"] as const) {
            const index = c++;
            if (index >= STRIDE)
              throw new RangeError(`generator ${g} has more than ${STRIDE} points`);
            const id = `G${g}/${gen.family}/${shapeId(shape)}/m${marginId(margin)}/${truth}`;
            const cand = truth === "zero" ? base : atMargin;
            // The generator cannot express this drop with these cases: skipped and counted.
            if (cand === undefined) {
              out.push({ id, points: [], skipped: 1 });
              continue;
            }
            const point: NiPoint = {
              id,
              generator: g,
              family: gen.family,
              shape,
              margin,
              truth,
              params: gen.params,
              seed: 30_000_000 + STRIDE * g + index,
              confirmSeed: 40_000_000 + STRIDE * g + index,
              draw: (rng) => gen.draw(rng, shape, cand, base),
            };
            out.push({ id, points: [point] });
          }
        }
      }
  }
  let cPrime = 0;
  for (const family of ["top", "floor"] as const)
    for (const nu of [2, 10])
      for (const shape of NI_SHAPES)
        for (const margin of MARGINS) {
          const index = cPrime++;
          const stream = structureStream(index);
          const points: NiPoint[] = [];
          let skipped = 0;
          // The first G2_NI_STRUCTURES of the stream, s = 0 to 99: a structure that cannot reach
          // the margin keeps its s and is skipped.
          for (let s = 0; s < G2_NI_STRUCTURES; s++) {
            const meanZero = g2Structure(stream, shape.k, family);
            const moved = toMargin(meanZero, family, margin);
            if (moved === undefined) skipped++;
            else points.push(g2Point(index, s, { family, nu }, shape, margin, moved, meanZero));
          }
          out.push({
            id: `G2/${family}-nu${nu}/${shapeId(shape)}/m${marginId(margin)}`,
            points,
            skipped,
            cellIndex: index,
            refine: (worst, count) => {
              const steps: NiPoint[] = [];
              let s = count;
              for (const w of worst.slice(0, G2_NI_REFINE_WORST)) {
                // Perturb the mean-0 shape, not the moved one: moving to the margin scales the
                // stable effects, and perturb would rebuild an offset beyond the range from them.
                const parsed = JSON.parse(w.params["shape"] as string) as [number, number][];
                for (let step = 0; step < G2_NI_REFINE_STEPS; step++, s++) {
                  const next = perturb(stream, parsed, family);
                  const moved = next === undefined ? undefined : toMargin(next, family, margin);
                  if (next !== undefined && moved !== undefined)
                    steps.push(g2Point(index, s, { family, nu }, shape, margin, moved, next));
                }
              }
              return steps;
            },
          });
        }
  // The concentrated family, after the other G2 cells.
  for (const shape of NI_SHAPES)
    for (const margin of MARGINS) {
      const index = cPrime++;
      const stream = structureStream(index);
      const points: NiPoint[] = [];
      let skipped = 0;
      for (let s = 0; s < G2_NI_STRUCTURES; s++) {
        const spec = concentratedShape(stream, shape.k);
        const at = concentratedAtMargin(spec, margin);
        if (at === undefined) skipped++;
        else points.push(concentratedPoint(index, s, shape, margin, at, spec));
      }
      out.push({
        id: `G2/concentrated/${shapeId(shape)}/m${marginId(margin)}`,
        points,
        skipped,
        cellIndex: index,
        refine: (worst, count) => {
          const steps: NiPoint[] = [];
          let s = count;
          for (const w of worst.slice(0, G2_NI_REFINE_WORST))
            for (let step = 0; step < G2_NI_REFINE_STEPS; step++, s++) {
              const spec = perturbConcentrated(
                stream,
                JSON.parse(w.params["shape"] as string) as ConcentratedShape,
              );
              const at = concentratedAtMargin(spec, margin);
              if (at !== undefined)
                steps.push(concentratedPoint(index, s, shape, margin, at, spec));
            }
          return steps;
        },
      });
    }
  return out;
}

/**
 * A point of a screened cell, by id: a grid point, or a G2 refinement step rebuilt from its stored
 * structure (rows of [base, candidate] or [base, candidate, ν]). The confirmation uses it, because
 * refinement steps exist only in the screening output.
 */
export function niPointById(
  byCell: ReadonlyMap<string, NiCell>,
  id: string,
  structure: string | undefined,
): NiPoint {
  const m = /^(G2\/[^/]+\/[^/]+\/m[\d.]+)\/s(\d+)$/.exec(id);
  const cell = byCell.get(m ? (m[1] as string) : id);
  if (cell === undefined) throw new Error(`no cell for point ${id}`);
  const known = cell.points.find((p) => p.id === id);
  if (known !== undefined) return known;
  const first = cell.points[0];
  if (!m || structure === undefined || first === undefined || cell.cellIndex === undefined)
    throw new Error(`no point ${id}`);
  const s = Number(m[2]);
  if (s >= 1000) throw new RangeError("a G2 cell has more than 1,000 structures");
  const rows = JSON.parse(structure) as number[][];
  const cellNu =
    typeof first.params["nu"] === "number" ? (first.params["nu"] as number) : undefined;
  return {
    ...first,
    id,
    params: { ...first.params, structure },
    seed: 50_000_000 + 1_000 * cell.cellIndex + s,
    confirmSeed: 60_000_000 + 1_000 * cell.cellIndex + s,
    draw: (rng) =>
      dataset(rng, first.shape, (r, i, arm) => {
        const row = rows[i] as number[];
        const nu = (row[2] ?? cellNu) as number;
        return beta(r, (arm === "base" ? row[0] : row[1]) as number, nu);
      }),
  };
}

/** Relative cost of a cell: its points and refinement steps times its trials. */
export function niCostOf(cell: NiCell): number {
  const first = cell.points[0];
  if (first === undefined) return 0;
  const trials = Array.from({ length: first.shape.k }, (_, i) => trialsOf(first.shape, i)).reduce(
    (a, [x, y]) => a + x + y,
    0,
  );
  const steps = cell.refine ? G2_NI_REFINE_WORST * G2_NI_REFINE_STEPS : 0;
  return (cell.points.length + steps) * (trials + 10);
}

/** Cells of shard `index` of `count`: longest processing time first, ties by cell order. */
export function niShardOf(all: readonly NiCell[], index: number, count: number): NiCell[] {
  const load = Array.from({ length: count }, () => 0);
  const owner = new Map<string, number>();
  const order = all
    .map((cell, i) => ({ cell, i, cost: niCostOf(cell) }))
    .toSorted((a, b) => b.cost - a.cost || a.i - b.i);
  for (const { cell, cost } of order) {
    let best = 0;
    for (let s = 1; s < count; s++) if ((load[s] as number) < (load[best] as number)) best = s;
    load[best] = (load[best] as number) + cost;
    owner.set(cell.id, best);
  }
  return all.filter((cell) => owner.get(cell.id) === index);
}
