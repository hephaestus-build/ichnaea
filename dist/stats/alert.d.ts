/**
 * Kish's design effect of a clustered sample, 1 + (m̃ − 1)ρ, with m̃ = Σm²/Σm the cluster-size
 * weighted mean size. The plain mean size would understate it when sessions differ in size.
 */
export declare function kishDesignEffect(sizes: readonly number[], rho: number): number;
/**
 * The intraclass correlation ρ of values clustered by session, by one-way ANOVA:
 * (MSB − MSW)/(MSB + (m₀ − 1)·MSW), with m₀ = (N − Σm²/N)/(k − 1). A negative estimate gives 0, so
 * the design effect is never below 1. It needs two clusters and a cluster with two values.
 */
export declare function intraclassCorrelation(clusters: readonly (readonly number[])[]): number;
/**
 * The true rate at which an alert rule on a closed window fires with the given power, under the
 * normal approximation at the effective number of traces n/DEFF. A `below: t` rule fires when the
 * window's upper one-sided bound at `level` is below t, taken as p̂ < t − z·√(t(1 − t)/n_eff). The
 * rate solves P(fire) = power. An `above: t` rule mirrors it. Null when no rate fires that often,
 * because the window is too small. The result is approximate.
 */
export declare function alertDetectableRate(input: {
    readonly threshold: number;
    readonly rule: "below" | "above";
    readonly traces: number;
    readonly designEffect: number;
    readonly level?: number;
    readonly power?: number;
}): {
    /** The true rate found 4 times in 5, or null when the window is too small. */
    readonly rate: number | null;
    /** n/DEFF. */
    readonly effectiveTraces: number;
    /** Always "approximate": a normal approximation at n_eff. */
    readonly label: "approximate";
};
//# sourceMappingURL=alert.d.ts.map