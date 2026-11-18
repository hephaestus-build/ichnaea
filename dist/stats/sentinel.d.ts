import type { Stratum } from "./score-difference.ts";
/** The drift guard's verdict on one run: its two-sided p-value, and whether the baseline drifted. */
export interface SentinelTestResult {
    /** Twice the smaller one-sided exact stratified conditional p-value, at most 1. */
    readonly p: number;
    /** True when p ≤ the level: the stored baseline drifted. */
    readonly drifted: boolean;
    /** The test's stable name. */
    readonly method: "exact-stratified-conditional-two-sided";
}
/**
 * The drift guard of a `fast` run: the exact stratified conditional test of the fresh base trials
 * (`candidate`) against the stored base trials (`base`) of the sentinel cases, two-sided as twice
 * the smaller one-sided p-value, because a drift in either direction invalidates the baseline.
 */
export declare function sentinelTest(strata: readonly Stratum[], level?: number): SentinelTestResult;
/**
 * The exact power of the sentinel test with `cases` cases of `trials` stored and `trials` fresh
 * trials, every stored trial at `stored` and every fresh trial at `fresh`. It sums over the counts
 * of cases at each case total t, which the test conditions on: C(cases + 2·trials, 2·trials) terms.
 */
export declare function sentinelPowerExact(cases: number, trials: number, stored: number, fresh: number, level?: number): number;
/**
 * The simulated power of the same test: `draws` runs from `seed`, each case drawing its stored
 * trials and then its fresh trials. Every call with the same seed uses the same uniforms, so the
 * powers at different fresh rates share their random numbers.
 */
export declare function sentinelPowerSimulated(cases: number, trials: number, stored: number, fresh: number, draws: number, seed: number, level?: number): number;
/** One direction of drift: the smallest drift the guard catches with the target power. */
export interface DriftDirection {
    /** The largest drift possible in this direction: 1 − p upward, p downward. */
    readonly largest: number;
    /** True when some possible drift reaches the target power. */
    readonly caught: boolean;
    /**
     * X: the smallest multiple of 0.05 at which the power reaches the target, or `largest` when
     * only the largest drift does. Null when no possible drift does.
     */
    readonly drift: number | null;
    /** The power at `drift`, or Y, the power at `largest` when the direction is not caught. */
    readonly power: number;
}
/** The drift guard's detectable drift, computed at plan time from the stored base. */
export interface SentinelDrift {
    /** p, the stored rate of the sentinel cases: every case at the same rate. */
    readonly rate: number;
    /** The number of sentinel cases. */
    readonly cases: number;
    /** The stored trials per case, and as many fresh trials. */
    readonly trials: number;
    /** The test's level, α_s. */
    readonly level: number;
    /** The target power, 4 times in 5 by default. */
    readonly target: number;
    /** Fresh below stored. */
    readonly down: DriftDirection;
    /** Fresh above stored: the dangerous direction, because it gives a false Pass. */
    readonly up: DriftDirection;
    /** `exact` while C(cases + 2·trials, 2·trials) ≤ 10⁵, otherwise `simulated`. */
    readonly method: "exact" | "simulated";
    /** The simulated draws, 10,000. */
    readonly draws?: number;
    /** The seed of the simulated draws. */
    readonly seed?: number;
}
/** `exact` while the exact power sums C(cases + 2·trials, 2·trials) ≤ 10⁵ terms, else `simulated`. */
export declare function sentinelMethod(cases: number, trials: number): "exact" | "simulated";
/**
 * The drift of every case together that the sentinel test catches 4 times in 5, in each
 * direction, with every case at the stored rate p of the sentinel cases. In simulation, different
 * rates per case gave equal or higher power, so this is the pessimistic reference, but it is not a
 * bound. The
 * drift is rounded up to the next 0.05. It is computed at plan time from the stored base, never
 * from the fresh trials. The power is exact while C(cases + 2·trials, 2·trials) ≤ 10⁵, and
 * otherwise simulated with 10,000 draws from `seed`, the same draws at every drift. It refuses more
 * than 500 trials per case.
 */
export declare function sentinelDetectableDrift(input: {
    readonly cases: number;
    readonly trials: number;
    readonly rate: number;
    readonly level?: number;
    readonly target?: number;
    readonly seed?: number;
}): SentinelDrift;
//# sourceMappingURL=sentinel.d.ts.map