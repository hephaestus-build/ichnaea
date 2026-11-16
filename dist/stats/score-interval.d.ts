import type { CaseScores } from "./score-permutation-core.ts";
/**
 * The pooled dispersion φ̂ = Σ SS / Σ [(n − 1)·ȳ(1 − ȳ) + SS/n] over cells with at least 2 values,
 * or 1 when there are none. The bracket is n − 1 times the unbiased estimate ȳ(1 − ȳ) + s²/n of
 * μ(1 − μ), so φ̂ estimates Var(Y) / (μ(1 − μ)). It is 1 for 0/1 values and at most 1 for any values
 * in [0, 1].
 */
export declare function pooledDispersion(cases: readonly CaseScores[]): number;
/**
 * The uncorrected dispersion Σ SS / Σ n·ȳ(1 − ȳ), a reported variant only: it estimates
 * (n − 1)φ / (n − φ), about half of φ at two values per cell, so it makes the bound too narrow.
 */
export declare function pooledDispersionUncorrected(cases: readonly CaseScores[]): number;
/**
 * The stratified score statistic Z₁(δ), at φ = 1: equal case weights, the N/(N−1) factor, no
 * skewness correction, with the sums of values as fractional counts in the restricted
 * maximum-likelihood estimates. φ scales only the variance, so Z_φ = Z₁/√φ, and the bound at φ is
 * the root of Z₁ at the target z·√φ (`scoreTarget`). Every φ therefore evaluates the same Z₁, and
 * the study can share its values across φ with the same floating-point operations as the bound.
 * Z₁ need not be monotone: a case whose arms are all 1 (or all 0) adds no variance at δ = 0 and
 * some next to it, so Z₁ can rise near 0. The root-finder takes the first crossing.
 */
export declare function scoreStatistic(cases: readonly CaseScores[]): (delta: number) => number;
/** The target of Z₁ for the bound at a level and a variance scale φ: z·√φ. At φ = 0 it is 0. */
export declare const scoreTarget: (level: number, phi: number) => number;
/**
 * The stratified score lower bound with the variance scaled by φ: S-A at φ = 1, S-B at
 * max(φ̂, φ_min). The root of Z₁ at z·√φ; at φ = 0 that is where Z₁ changes sign, the estimate.
 */
export declare function scoreBound(cases: readonly CaseScores[], level: number, phi: number): number;
export declare const boundSA: (cases: readonly CaseScores[], level: number) => number;
export declare const boundSB: (cases: readonly CaseScores[], level: number, phiMin: number) => number;
/**
 * S-C: the stratified t bound with one pooled within-cell variance s²_p = Σ SS / Σ (n − 1) and
 * df = Σ (n − 1). Undefined (null) without residual degrees of freedom.
 */
export declare function boundSC(cases: readonly CaseScores[], level: number): number | null;
/** P(T ≤ t) for Student's t with df degrees of freedom. */
export declare function studentCdf(t: number, df: number): number;
/**
 * The quantile of Student's t at p in (0, 1) with df > 0 degrees of freedom, by bisection. It
 * refuses any other p or df, and a search that does not close throws instead of running on.
 */
export declare function studentQuantile(p: number, df: number): number;
//# sourceMappingURL=score-interval.d.ts.map