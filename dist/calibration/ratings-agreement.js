import { krippendorffAlpha } from "../stats/agreement.js";
import { createRng } from "../stats/rng.js";
import { CALIBRATION_DEFAULTS } from "./analyze.js";
import { quantile, sorted } from "./statistics.js";
function groupItems(units) {
    const strata = new Map();
    const itemStrata = new Map();
    const slots = units[0]?.raters.length ?? 0;
    if (slots < 2)
        throw new RangeError("agreement needs a unit with at least two rater columns");
    for (const { item, stratum, raters } of units) {
        if (raters.length !== slots)
            throw new RangeError("all units need the same rater columns");
        const previous = itemStrata.get(item);
        if (previous !== undefined && previous !== stratum)
            throw new RangeError("an item cannot belong to more than one stratum");
        itemStrata.set(item, stratum);
        const items = strata.get(stratum) ?? new Map();
        const rows = items.get(item) ?? [];
        rows.push(raters);
        items.set(item, rows);
        strata.set(stratum, items);
    }
    return [...strata.values()].map((items) => [...items.values()]);
}
/** Resample whole items within each stratum, then recompute alpha in every draw. */
export function summarizeRatings(input, seed) {
    const { metric, units } = input;
    const strata = groupItems(units);
    const scores = units.map(({ raters }) => raters);
    const observed = scores.map((raters) => raters.filter((rating) => rating !== null).length);
    const paired = observed.filter((count) => count >= 2);
    const pairedItems = new Set(units.filter((_, index) => observed[index] >= 2).map(({ item }) => item)).size;
    const estimate = krippendorffAlpha(scores, metric);
    const rng = createRng(seed);
    const itemCount = strata.reduce((count, items) => count + items.length, 0);
    let unavailableReason = null;
    if (!Number.isFinite(estimate))
        unavailableReason = "alpha is undefined";
    else if (pairedItems < 2)
        unavailableReason = "fewer than two items have paired ratings";
    else if (!strata.some((items) => items.length > 1))
        unavailableReason = "every stratum has only one item";
    const resamples = unavailableReason === null ? CALIBRATION_DEFAULTS.resamples : 0;
    const estimates = sorted(Array.from({ length: resamples }, () => {
        const sample = strata.flatMap((items) => items.flatMap(() => items[Math.floor(rng.uniform() * items.length)]));
        return krippendorffAlpha(sample, metric);
    }));
    if (unavailableReason === null && estimates.length === 0)
        unavailableReason = "no resample gave a finite alpha";
    else if (unavailableReason === null && estimates[0] === estimates.at(-1))
        unavailableReason = "the finite resamples all give the same alpha";
    return {
        statistic: "krippendorff-alpha",
        metric,
        estimate: Number.isFinite(estimate) ? estimate : null,
        counts: {
            items: itemCount,
            units: units.length,
            pairedUnits: paired.length,
            pairedItems,
            raters: scores[0].length,
            ratings: observed.reduce((sum, count) => sum + count, 0),
            pairedRatings: paired.reduce((sum, count) => sum + count, 0),
        },
        interval: {
            method: "item-cluster-percentile",
            level: 0.95,
            validated: false,
            seed: rng.seed,
            algorithm: rng.algorithm,
            lower: unavailableReason === null ? quantile(estimates, 0.025) : null,
            upper: unavailableReason === null ? quantile(estimates, 0.975) : null,
            resamples,
            omittedResamples: resamples - estimates.length,
            unavailableReason,
        },
    };
}
//# sourceMappingURL=ratings-agreement.js.map