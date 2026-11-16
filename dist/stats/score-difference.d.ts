import { type Count, type Interval, type Sided, type TestResult } from "./types.ts";
/** One stratum: the candidate's and the base's count. In `fixed-cases`, one stratum per case. */
export interface Stratum {
    /** The candidate's count in the stratum. */
    readonly candidate: Count;
    /** The base's count in the stratum. */
    readonly base: Count;
}
/**
 * Options of the stratified score method for a difference of proportions. The defaults are the
 * Miettinen–Nurminen method: bias correction on, skewness correction off. A simulation study
 * (scripts/stats/study-fixed-cases.ts, 252 grid points, 10,000 repetitions) chose them: at 2 replicates
 * per case the variants without the N/(N-1) factor undercover (minimum 0.88 to 0.92), and the
 * skewness correction does not help once the factor is applied.
 */
export interface ScoreOptions {
    /** Miettinen–Nurminen's N/(N-1) variance factor per stratum. Default true. */
    readonly biasCorrection?: boolean;
    /** Gart–Nam skewness correction (Laud 2017). Default false. */
    readonly skewnessCorrection?: boolean;
    /**
     * Stratum weights. `equal` (the default) weights every case alike, so the estimate is the mean
     * of the per-case differences: the fixed-cases estimand, whatever the replicate counts.
     * `mantel-haenszel` weights by n1·n2/(n1+n2), which equals `equal` when every case has the same
     * counts.
     */
    readonly weights?: "equal" | "mantel-haenszel";
}
interface Restricted {
    readonly p1: number;
    readonly p2: number;
}
/**
 * Maximum-likelihood estimates of both proportions under the constraint p1 - p2 = delta
 * (Farrington and Manning 1990, closed form of Miettinen and Nurminen 1985).
 */
export declare function restrictedMle(x1: number, n1: number, x2: number, n2: number, delta: number): Restricted;
/**
 * Gart–Nam skewness correction (Laud 2017): the corrected score S solves
 * score = S + c (S^2 - 1), with c = mu3 / (6 V^(3/2)). The root that tends to `score` as c -> 0.
 */
export declare function skewCorrected(score: number, c: number): number;
/**
 * Score interval for a difference of proportions, candidate minus base, stratified over cases
 * (Miettinen–Nurminen with Mantel–Haenszel weights).
 * A case without variance still contributes, because its variance is evaluated under each
 * hypothesised difference, so the interval does not collapse on stable cases.
 */
export declare function scoreDifferenceInterval(strata: readonly Stratum[], level?: number, sided?: Sided, options?: ScoreOptions): Interval;
/**
 * One-sided score test of H0: difference <= delta0 against H1: difference > delta0
 * (`greater`), or H0: difference >= delta0 against H1: difference < delta0 (`less`).
 */
export declare function scoreDifferenceTest(strata: readonly Stratum[], delta0: number, alternative: "greater" | "less", options?: ScoreOptions): TestResult;
export {};
//# sourceMappingURL=score-difference.d.ts.map