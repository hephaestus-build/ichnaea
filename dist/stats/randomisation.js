/** Monte Carlo resamples when a randomisation test cannot enumerate. */
export const DEFAULT_RESAMPLES = 10_000;
/** A uniform draw from the hypergeometric distribution by sequential sampling without replacement. */
function hypergeometric(rng, population, successes, draws) {
    let left = population;
    let good = successes;
    let picked = 0;
    for (let i = 0; i < draws; i++) {
        if (rng.uniform() < good / left) {
            picked++;
            good--;
        }
        left--;
    }
    return picked;
}
/**
 * Within-case permutation test of "no difference in any case", for the mean of per-case
 * differences (the fixed-cases estimand with equal case weights). Arm labels are permuted within
 * each case, so each case's candidate successes are hypergeometric given its total. Monte Carlo
 * with a seeded generator; p = (1 + count) / (1 + resamples). One-sided toward a drop (`less`).
 */
export function withinCasePermutationTest(strata, rng, resamples = DEFAULT_RESAMPLES) {
    const used = strata.filter((s) => s.candidate.trials > 0 && s.base.trials > 0);
    if (used.length === 0)
        return { statistic: 0, p: 1, method: "within-case-permutation" };
    const statistic = (x1) => used.reduce((acc, s, i) => acc +
        x1[i] / s.candidate.trials -
        (s.candidate.successes + s.base.successes - x1[i]) / s.base.trials, 0) / used.length;
    const observed = statistic(used.map((s) => s.candidate.successes));
    const tolerance = 1e-12;
    let extreme = 0;
    for (let r = 0; r < resamples; r++) {
        const x1 = used.map((s) => hypergeometric(rng, s.candidate.trials + s.base.trials, s.candidate.successes + s.base.successes, s.candidate.trials));
        if (statistic(x1) <= observed + tolerance)
            extreme++;
    }
    return {
        statistic: observed,
        p: (1 + extreme) / (1 + resamples),
        method: "within-case-permutation",
    };
}
//# sourceMappingURL=randomisation.js.map