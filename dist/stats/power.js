import { qnorm } from "./normal.js";
import { scoreDifferenceInterval } from "./score-difference.js";
import { tangoInterval } from "./tango.js";
function quantile(sorted, q) {
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
    return sorted[index];
}
/**
 * The smallest non-inferiority margin that can pass under `fixed-cases` when nothing changed and
 * every trial passes in both arms: the zero-noise floor of the stratified score bound. Real
 * within-case noise raises it.
 */
export function fixedCasesFloor(cases, replicates, alpha = 0.05, options = {}) {
    return zeroNoiseFloor(Array.from({ length: cases }, () => replicates), alpha, options);
}
/**
 * The zero-noise floor for any trial count per case (every case passes every trial in both arms),
 * with equal case weights as `compareCounts` uses them. `trials[j]` is case j's trials per arm.
 */
export function zeroNoiseFloor(trials, alpha = 0.05, options = {}) {
    const strata = trials.map((r) => ({
        candidate: { successes: r, trials: r },
        base: { successes: r, trials: r },
    }));
    return -scoreDifferenceInterval(strata, 1 - alpha, "lower", { weights: "equal", ...options })
        .lower;
}
/** The same floor under `sampled-cases`: every pair concordant, the skewness-corrected Tango bound. */
export function sampledCasesFloor(cases, alpha = 0.05) {
    return -tangoInterval({ both: cases, candidateOnly: 0, baseOnly: 0, neither: 0 }, 1 - alpha, "lower", true).lower;
}
/** Approximate cases needed under `sampled-cases` for a margin at a discordance rate (true difference 0). */
export function sampledCasesNeeded(discordance, margin, alpha = 0.05, power = 0.8) {
    const z = qnorm(1 - alpha) + qnorm(power);
    return Math.ceil((z * z * discordance) / (margin * margin));
}
/**
 * The minimum detectable effect of the method itself, by simulation: with both arms drawn from
 * the same per-case rates (true difference 0), the margin that the non-inferiority test passes
 * with the stated power. It is the `power` quantile of the negated lower bound. No normal
 * approximation, so it is exact for the method up to Monte Carlo error.
 */
export function fixedCasesMde(input) {
    const alpha = input.alpha ?? 0.05;
    const power = input.power ?? 0.8;
    const simulations = input.simulations ?? 2000;
    const trials = input.rates.map((_, j) => typeof input.replicates === "number" ? input.replicates : input.replicates[j]);
    const draw = (rate, r) => {
        let s = 0;
        for (let i = 0; i < r; i++)
            if (input.rng.uniform() < rate)
                s++;
        return s;
    };
    const needed = [];
    for (let k = 0; k < simulations; k++) {
        const strata = input.rates.map((rate, j) => {
            const r = trials[j];
            return {
                candidate: { successes: draw(rate, r), trials: r },
                base: { successes: draw(rate, r), trials: r },
            };
        });
        needed.push(-scoreDifferenceInterval(strata, 1 - alpha, "lower", { weights: "equal", ...input.options })
            .lower);
    }
    needed.sort((a, b) => a - b);
    return {
        mde: quantile(needed, power),
        floor: zeroNoiseFloor(trials, alpha, input.options),
        simulations,
    };
}
//# sourceMappingURL=power.js.map