import { armBias, gap, humanHuman, judgeHuman, ordinalAlpha, pairChange, quantile, sensitivity, sorted, specificity, valueOf, weightedAc1, } from "./statistics.js";
/** The status statistics of a scale, by name. */
export function statusStatistics(scale) {
    return scale === "levels"
        ? { agreement: ordinalAlpha }
        : { agreement: weightedAc1, sensitivity, specificity };
}
/** The agreement statistic of a scale. */
export function agreementStatistic(scale) {
    return scale === "levels" ? ordinalAlpha : weightedAc1;
}
/** A gap condition: the lower bound of the gaps is at least −tolerance. */
function gapCondition(gaps, tolerance) {
    const values = sorted(gaps);
    const lower = values.length > 0 ? quantile(values, 0.05) : Number.NaN;
    return { holds: values.length > 0 && lower >= -tolerance, lower };
}
/**
 * Runs the bootstrap: each resample draws, within each stratum, as many items as it has, with
 * replacement, and takes all their answers. A resample in which a status statistic is undefined
 * (no defect or no non-defect to condition on, or an undefined alpha) is counted and left out of
 * that statistic's quantile.
 */
export function bootstrapCalibration(set, values, rng) {
    const value = valueOf(set);
    const answersOf = Array.from({ length: set.cases }, () => []);
    set.caseOf.forEach((c, i) => answersOf[c].push(i));
    const strata = new Map();
    set.stratumOf.forEach((s, c) => {
        if (!strata.has(s))
            strata.set(s, []);
        strata.get(s).push(c);
    });
    const all = set.caseOf.map((_, i) => i);
    const statistics = statusStatistics(set.scale);
    const tolerance = (name) => name === "sensitivity" || name === "specificity"
        ? values.rateTolerance
        : values.agreementTolerance;
    const gaps = Object.fromEntries(Object.keys(statistics).map((k) => [k, []]));
    const biases = [];
    const raterAgreement = [];
    const raterStatistic = agreementStatistic(set.scale);
    const floor = values.raterFloor[set.scale === "levels" ? "alpha" : "ac1"];
    const hasPair = set.scale === "binary" && set.configurationOf.includes(2);
    const judgeLabel = (i) => set.judge[i];
    const raterLabel = (i) => (set.first[i] + set.second[i]) / 2;
    const slopes = [];
    const humanChanges = [];
    const pairBiases = [];
    let undefinedResamples = 0;
    for (let r = 0; r < values.resamples; r++) {
        const answers = [];
        for (const cases of strata.values()) {
            for (let k = 0; k < cases.length; k++) {
                answers.push(...answersOf[cases[Math.floor(rng.uniform() * cases.length)]]);
            }
        }
        biases.push(armBias(set, answers, value));
        raterAgreement.push(raterStatistic(set.first, set.second, answers, set.weight));
        if (hasPair) {
            const human = pairChange(set, answers, raterLabel);
            const judgeChange = pairChange(set, answers, judgeLabel);
            humanChanges.push(human);
            slopes.push(judgeChange / human);
            pairBiases.push(judgeChange - human);
        }
        let undefinedStatus = false;
        for (const [name, statistic] of Object.entries(statistics)) {
            const g = gap(set, statistic, answers);
            gaps[name].push(g);
            if (Number.isNaN(g))
                undefinedStatus = true;
        }
        if (undefinedStatus)
            undefinedResamples += 1;
    }
    const agreements = sorted(raterAgreement);
    const floorLower = agreements.length > 0 ? quantile(agreements, 0.05) : Number.NaN;
    const sortedBiases = biases.filter((x) => !Number.isNaN(x)).toSorted((x, y) => x - y);
    const lower90 = quantile(sortedBiases, 0.05);
    const upper90 = quantile(sortedBiases, 0.95);
    const slope = hasPair
        ? (() => {
            const pair = sorted(pairBiases);
            const human = pairChange(set, all, raterLabel);
            return {
                estimate: pairChange(set, all, judgeLabel) / human,
                lower: Math.min(1, quantile(sorted(slopes), 0.05)),
                humanChange: human,
                humanChangeUpper: quantile(sorted(humanChanges), 0.95),
                pairBound: Math.max(Math.abs(quantile(pair, 0.05)), Math.abs(quantile(pair, 0.95))),
            };
        })()
        : undefined;
    const shownBound = Math.max(Math.abs(lower90), Math.abs(upper90));
    const margin = values.armBiasMargin[set.scale === "levels" ? "levels" : "binary"];
    return {
        conditions: {
            ratersFloor: { holds: agreements.length > 0 && floorLower >= floor, lower: floorLower },
            armBias: { holds: shownBound <= margin },
            ...Object.fromEntries(Object.entries(gaps).map(([name, g]) => [name, gapCondition(g, tolerance(name))])),
        },
        armBias: {
            estimate: armBias(set, all, value),
            lower90,
            upper90,
            shownBound,
        },
        ...(slope === undefined ? {} : { slope }),
        undefinedResamples,
    };
}
/** Whether every condition of the bootstrap holds: the judge is calibrated. */
export function calibrated(boot) {
    return Object.values(boot.conditions).every((condition) => condition.holds);
}
/** The point estimates on the whole set. */
export function estimates(set) {
    const all = set.caseOf.map((_, i) => i);
    const agreement = agreementStatistic(set.scale);
    const pair = (statistic) => ({
        judge: judgeHuman(set, statistic, all),
        humanHuman: humanHuman(set, statistic, all),
    });
    return {
        humanHuman: agreement(set.first, set.second, all, set.weight),
        judgeHuman: judgeHuman(set, agreement, all),
        ...(set.scale === "binary"
            ? { sensitivity: pair(sensitivity), specificity: pair(specificity) }
            : {}),
    };
}
//# sourceMappingURL=engine.js.map