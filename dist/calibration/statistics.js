// The weighted calibration statistics over a set's answers. Every statistic weights each answer by
// 1/π, its inverse inclusion probability. Ordinal alpha is the exception: it takes unweighted sets
// only, and the analysis refuses weighted levels.
import { krippendorffAlpha } from "../stats/agreement.js";
/** R's type-7 quantile of a sorted array. */
export function quantile(values, p) {
    const h = (values.length - 1) * p;
    const low = Math.floor(h);
    const high = Math.min(low + 1, values.length - 1);
    return values[low] + (h - low) * (values[high] - values[low]);
}
/** The finite values, sorted. */
export function sorted(xs) {
    return xs.filter((x) => Number.isFinite(x)).toSorted((x, y) => x - y);
}
/** The weighted share of `y`'s positives (of = 1) or negatives (of = 0) that `x` marks the same. NaN if none. */
function rate(x, y, answers, w, of) {
    let base = 0;
    let hit = 0;
    for (const i of answers) {
        if (y[i] !== of)
            continue;
        base += w[i];
        if (x[i] === of)
            hit += w[i];
    }
    return base === 0 ? Number.NaN : hit / base;
}
/** The weighted share of the reference's defects that `x` also marks: sensitivity. */
export const sensitivity = (x, y, answers, w) => rate(x, y, answers, w, 1);
/** The weighted share of the reference's non-defects that `x` also marks: specificity. */
export const specificity = (x, y, answers, w) => rate(x, y, answers, w, 0);
/**
 * Gwet's AC1 for two raters with answer weights: (p_o − p_e)/(1 − p_e), p_e = Σ π_k(1 − π_k)/(q − 1)
 * with q = 2, every count weighted. With unit weights it equals `gwetAc1` of ./stats, which takes
 * integer counts only.
 */
export const weightedAc1 = (x, y, answers, w) => {
    let total = 0;
    let agree = 0;
    let positive = 0;
    for (const i of answers) {
        total += w[i];
        if (x[i] === y[i])
            agree += w[i];
        positive += (w[i] * (x[i] + y[i])) / 2;
    }
    const po = agree / total;
    const pi = positive / total;
    const pe = 2 * pi * (1 - pi);
    return (po - pe) / (1 - pe);
};
/** Krippendorff's ordinal alpha of two readers. It ignores the weights: levels are unweighted. */
export const ordinalAlpha = (x, y, answers) => krippendorffAlpha(answers.map((i) => [x[i], y[i]]), "ordinal");
/**
 * The judge against each rater (their mean) minus each rater against the other (their mean). For
 * a directional statistic such as sensitivity, the reference is the second argument, so the
 * rater–rater value is the mean of rater 2 against rater 1 and rater 1 against rater 2.
 */
export function gap(set, statistic, answers) {
    return judgeHuman(set, statistic, answers) - humanHuman(set, statistic, answers);
}
/** The judge against each rater, the mean of the two. */
export function judgeHuman(set, statistic, answers) {
    const w = set.weight;
    return ((statistic(set.judge, set.first, answers, w) + statistic(set.judge, set.second, answers, w)) / 2);
}
/** Each rater against the other, the mean of the two directions. */
export function humanHuman(set, statistic, answers) {
    const w = set.weight;
    return ((statistic(set.second, set.first, answers, w) + statistic(set.first, set.second, answers, w)) /
        2);
}
/** A label on [0, 1]: a yes/no label as it is, a level as (level − 1)/(levels − 1). */
export function valueOf(set) {
    const scale = set.scale === "levels" ? set.levels - 1 : 1;
    return (labels, i) => (set.scale === "levels" ? (labels[i] - 1) / scale : labels[i]);
}
/**
 * The bias between base and candidate: the weighted mean of (judge − the raters' mean) over the
 * candidate's answers, minus the same over the base's, on [0, 1]. With one answer per
 * configuration per item and unit weights, it equals the mean per-item difference.
 */
export function armBias(set, answers, value) {
    const sum = [0, 0];
    const weight = [0, 0];
    for (const i of answers) {
        const k = set.configurationOf[i];
        if (k > 1)
            continue;
        const d = value(set.judge, i) - (value(set.first, i) + value(set.second, i)) / 2;
        sum[k] += set.weight[i] * d;
        weight[k] += set.weight[i];
    }
    return sum[1] / weight[1] - sum[0] / weight[0];
}
/**
 * The weighted mean quality (1 − label) of `labels` on known-worse minus base: the change from the
 * base to the known-worse configuration, on yes/no labels. Negative is a drop.
 */
export function pairChange(set, answers, labels) {
    const sum = [0, 0];
    const weight = [0, 0];
    for (const i of answers) {
        const k = set.configurationOf[i];
        if (k === 1)
            continue;
        const slot = k === 2 ? 1 : 0;
        sum[slot] += set.weight[i] * (1 - labels(i));
        weight[slot] += set.weight[i];
    }
    return sum[1] / weight[1] - sum[0] / weight[0];
}
//# sourceMappingURL=statistics.js.map