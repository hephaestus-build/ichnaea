import type { Stratum } from "./score-difference.ts";
/**
 * The standardized stratified score statistic of one run, z = (O − E)/√V: O is the candidate's
 * total passes, and E and V sum the hypergeometric mean and variance of the candidate's passes in
 * each stratum, given the stratum's total, as the exact regression test conditions on them. It is
 * about N(0, 1) when nothing changed. Null when V = 0: no stratum has a pass and a failure.
 */
export declare function stratifiedZ(strata: readonly Stratum[]): {
    readonly z: number;
} | null;
/**
 * The overdispersion ratio of one primary measure across the noise runs of a setup: Σz²/N over the
 * N runs that have a z, with the interval [Σz²/χ²₁₋α/₂(N), Σz²/χ²α/₂(N)] for the scale φ in
 * Σz² ~ φ·χ²(N). The interval is approximate and discrete at small counts. A run with V = 0 is
 * left out and counted. Reported only, never a decision criterion, and never pooled across
 * measures, whose runs are correlated.
 */
export declare function overdispersion(runs: readonly (readonly Stratum[])[], level?: number): {
    /** Σz²/N, NaN without a run. */
    readonly ratio: number;
    /** The interval's lower bound on the scale φ. */
    readonly lower: number;
    /** The interval's upper bound on the scale φ. */
    readonly upper: number;
    /** The interval's two-sided level. */
    readonly level: number;
    /** The runs that have a z. */
    readonly runs: number;
    /** The runs left out because V = 0. */
    readonly excluded: number;
    /** The interval's method: approximate, and discrete at small counts. */
    readonly method: "chi-square-approximate";
};
//# sourceMappingURL=overdispersion.d.ts.map