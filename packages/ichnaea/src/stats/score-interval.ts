// Prototype (not exported): the three candidate non-inferiority bounds for score measures, S-A, S-B
// and S-C, for the screening study. Each is a one-sided lower bound for the equal-weight mean of
// per-case differences in means, candidate minus base, with every value in [0, 1].
import { critical } from "./normal.ts";
import { restrictedMle } from "./score-difference.ts";
import type { CaseScores } from "./score-permutation-core.ts";
import { lowerRoot } from "./solve.ts";

/** One case's sufficient statistics per arm: count, sum and within-arm sum of squares. */
interface Cell {
  readonly n: number;
  readonly sum: number;
  readonly ss: number;
}

const cellOf = (values: readonly number[]): Cell => {
  const n = values.length;
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  return { n, sum, ss: values.reduce((a, y) => a + (y - mean) ** 2, 0) };
};

function cellsOf(cases: readonly CaseScores[]): { candidate: Cell; base: Cell }[] {
  const used = cases.filter((c) => c.candidate.length > 0 && c.base.length > 0);
  for (const c of used)
    for (const v of [...c.candidate, ...c.base])
      if (!(Number.isFinite(v) && v >= 0 && v <= 1))
        throw new RangeError(`case '${c.id}': score ${v} is not in [0, 1]`);
  return used.map((c) => ({ candidate: cellOf(c.candidate), base: cellOf(c.base) }));
}

const estimateOf = (cells: readonly { candidate: Cell; base: Cell }[]): number =>
  cells.reduce((a, c) => a + c.candidate.sum / c.candidate.n - c.base.sum / c.base.n, 0) /
  cells.length;

/**
 * The pooled dispersion φ̂ = Σ SS / Σ [(n − 1)·ȳ(1 − ȳ) + SS/n] over cells with at least 2 values,
 * or 1 when there are none. The bracket is n − 1 times the unbiased estimate ȳ(1 − ȳ) + s²/n of
 * μ(1 − μ), so φ̂ estimates Var(Y) / (μ(1 − μ)). It is 1 for 0/1 values and at most 1 for any values
 * in [0, 1].
 */
export function pooledDispersion(cases: readonly CaseScores[]): number {
  let ss = 0;
  let scale = 0;
  for (const c of cellsOf(cases))
    for (const cell of [c.candidate, c.base]) {
      if (cell.n < 2) continue;
      const mean = cell.sum / cell.n;
      ss += cell.ss;
      scale += (cell.n - 1) * mean * (1 - mean) + cell.ss / cell.n;
    }
  return scale === 0 ? 1 : ss / scale;
}

/**
 * The uncorrected dispersion Σ SS / Σ n·ȳ(1 − ȳ), a reported variant only: it estimates
 * (n − 1)φ / (n − φ), about half of φ at two values per cell, so it makes the bound too narrow.
 */
export function pooledDispersionUncorrected(cases: readonly CaseScores[]): number {
  let ss = 0;
  let scale = 0;
  for (const c of cellsOf(cases))
    for (const cell of [c.candidate, c.base]) {
      const mean = cell.sum / cell.n;
      ss += cell.ss;
      scale += cell.n * mean * (1 - mean);
    }
  return scale === 0 ? 1 : ss / scale;
}

/**
 * The stratified score statistic Z₁(δ), at φ = 1: equal case weights, the N/(N−1) factor, no
 * skewness correction, with the sums of values as fractional counts in the restricted
 * maximum-likelihood estimates. φ scales only the variance, so Z_φ = Z₁/√φ, and the bound at φ is
 * the root of Z₁ at the target z·√φ (`scoreTarget`). Every φ therefore evaluates the same Z₁, and
 * the study can share its values across φ with the same floating-point operations as the bound.
 * Z₁ need not be monotone: a case whose arms are all 1 (or all 0) adds no variance at δ = 0 and
 * some next to it, so Z₁ can rise near 0. The root-finder takes the first crossing.
 */
export function scoreStatistic(cases: readonly CaseScores[]): (delta: number) => number {
  const cells = cellsOf(cases);
  if (cells.length === 0) throw new RangeError("no case has a value in both arms");
  const k = cells.length;
  const estimate = estimateOf(cells);
  return (deltaIn: number): number => {
    const delta = Math.min(1 - 1e-12, Math.max(-1 + 1e-12, deltaIn));
    let variance = 0;
    for (const { candidate: c, base: b } of cells) {
      const { p1, p2 } = restrictedMle(c.sum, c.n, b.sum, b.n, delta);
      const factor = (c.n + b.n) / (c.n + b.n - 1);
      variance += ((p1 * (1 - p1)) / c.n + (p2 * (1 - p2)) / b.n) * factor;
    }
    variance /= k * k;
    const numerator = estimate - delta;
    if (variance <= 0) return numerator > 0 ? Infinity : numerator < 0 ? -Infinity : 0;
    return numerator / Math.sqrt(variance);
  };
}

/** The target of Z₁ for the bound at a level and a variance scale φ: z·√φ. At φ = 0 it is 0. */
export const scoreTarget = (level: number, phi: number): number =>
  critical(level, "lower") * Math.sqrt(phi);

/**
 * The stratified score lower bound with the variance scaled by φ: S-A at φ = 1, S-B at
 * max(φ̂, φ_min). The root of Z₁ at z·√φ; at φ = 0 that is where Z₁ changes sign, the estimate.
 */
export function scoreBound(cases: readonly CaseScores[], level: number, phi: number): number {
  return lowerRoot(scoreStatistic(cases), scoreTarget(level, phi), -1, 1);
}

export const boundSA = (cases: readonly CaseScores[], level: number): number =>
  scoreBound(cases, level, 1);

export const boundSB = (cases: readonly CaseScores[], level: number, phiMin: number): number =>
  scoreBound(cases, level, Math.max(pooledDispersion(cases), phiMin));

/**
 * S-C: the stratified t bound with one pooled within-cell variance s²_p = Σ SS / Σ (n − 1) and
 * df = Σ (n − 1). Undefined (null) without residual degrees of freedom.
 */
export function boundSC(cases: readonly CaseScores[], level: number): number | null {
  const cells = cellsOf(cases);
  const k = cells.length;
  let ss = 0;
  let df = 0;
  for (const c of cells)
    for (const cell of [c.candidate, c.base]) {
      ss += cell.ss;
      df += cell.n - 1;
    }
  if (df === 0) return null;
  const pooled = ss / df;
  const se =
    Math.sqrt(cells.reduce((a, c) => a + pooled * (1 / c.candidate.n + 1 / c.base.n), 0)) / k;
  return estimateOf(cells) - studentQuantile(level, df) * se;
}

// --- Student's t --------------------------------------------------------------------------------

/** log Γ(x) for x > 0, Lanczos (g = 7, 9 terms). */
function logGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = c[0] as number;
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += (c[i] as number) / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** The regularized incomplete beta I_x(a, b), by Lentz's continued fraction. */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x > (a + 1) / (a + b + 2)) return 1 - incompleteBeta(1 - x, b, a);
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  const tiny = 1e-300;
  let f = 1;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  f = d;
  for (let m = 1; m <= 500; m++) {
    const m2 = 2 * m;
    let num = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + num * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + num / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    f *= d * c;
    num = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + num * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + num / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const step = d * c;
    f *= step;
    if (Math.abs(step - 1) < 1e-16) break;
  }
  return (front * f) / a;
}

/** P(T ≤ t) for Student's t with df degrees of freedom. */
export function studentCdf(t: number, df: number): number {
  const tail = 0.5 * incompleteBeta(df / (df + t * t), df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

/** The quantile of Student's t at p in (0.5, 1), by bisection. */
export function studentQuantile(p: number, df: number): number {
  let low = 0;
  let high = 1;
  while (studentCdf(high, df) < p) high *= 2;
  for (let i = 0; i < 200 && high - low > 1e-14 * high; i++) {
    const mid = (low + high) / 2;
    if (studentCdf(mid, df) < p) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}
