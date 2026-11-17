import { chiSquareQuantile } from "./chi-square.js";
import { assertCount, assertLevel } from "./types.js";
/**
 * The standardized stratified score statistic of one run, z = (O − E)/√V: O is the candidate's
 * total passes, and E and V sum the hypergeometric mean and variance of the candidate's passes in
 * each stratum, given the stratum's total, as the exact regression test conditions on them. It is
 * about N(0, 1) when nothing changed. Null when V = 0: no stratum has a pass and a failure.
 */
export function stratifiedZ(strata) {
    let observed = 0;
    let expected = 0;
    let variance = 0;
    for (const { candidate, base } of strata) {
        assertCount(candidate, "stratifiedZ candidate");
        assertCount(base, "stratifiedZ base");
        const n1 = candidate.trials;
        const n2 = base.trials;
        const n = n1 + n2;
        if (n1 === 0 || n2 === 0)
            continue;
        const t = candidate.successes + base.successes;
        observed += candidate.successes;
        expected += (n1 * t) / n;
        variance += (n1 * n2 * t * (n - t)) / (n * n * (n - 1));
    }
    return variance > 0 ? { z: (observed - expected) / Math.sqrt(variance) } : null;
}
/**
 * The overdispersion ratio of one primary measure across the noise runs of a setup: Σz²/N over the
 * N runs that have a z, with the interval [Σz²/χ²₁₋α/₂(N), Σz²/χ²α/₂(N)] for the scale φ in
 * Σz² ~ φ·χ²(N). The interval is approximate and discrete at small counts. A run with V = 0 is
 * left out and counted. Reported only, never a decision criterion, and never pooled across
 * measures, whose runs are correlated.
 */
export function overdispersion(runs, level = 0.95) {
    assertLevel(level);
    const zs = runs.map(stratifiedZ).filter((r) => r !== null);
    const n = zs.length;
    const method = "chi-square-approximate";
    const excluded = runs.length - n;
    if (n === 0)
        return { ratio: Number.NaN, lower: 0, upper: Infinity, level, runs: 0, excluded, method };
    const sum = zs.reduce((a, r) => a + r.z * r.z, 0);
    const tail = (1 - level) / 2;
    return {
        ratio: sum / n,
        lower: sum / chiSquareQuantile(1 - tail, n),
        upper: sum / chiSquareQuantile(tail, n),
        level,
        runs: n,
        excluded,
        method,
    };
}
//# sourceMappingURL=overdispersion.js.map