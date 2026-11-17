import { bcaInterval } from "./bca.js";
import { pooledClopperPearson } from "./clopper-pearson.js";
import { hoeffding } from "./hoeffding.js";
import { oneArmScoreInterval } from "./one-arm-score.js";
import { assertLevel } from "./types.js";
import { wilsonMean } from "./wilson.js";
import { weightedMean } from "./weighted-mean.js";
/** The fewest top clusters a `population` interval needs. */
export const POPULATION_MIN_CLUSTERS = 30;
function prepare(input) {
    const ids = new Set();
    return input.cases.map((c) => {
        if (ids.has(c.id))
            throw new RangeError(`case '${c.id}' appears more than once`);
        ids.add(c.id);
        for (const v of c.values) {
            const ok = input.valueType === "binary" ? v === 0 || v === 1 : Number.isFinite(v) && v >= 0 && v <= 1;
            if (!ok)
                throw new RangeError(`case '${c.id}': ${v} is not a ${input.valueType} value`);
        }
        const planned = c.planned ?? c.values.length;
        if (!(Number.isInteger(planned) && planned >= c.values.length))
            throw new RangeError(`case '${c.id}': ${planned} planned trials, ${c.values.length} values`);
        return {
            id: c.id,
            family: c.family ?? `\u0000${c.id}`,
            sum: c.values.reduce((a, b) => a + b, 0),
            trials: c.values.length,
            planned,
            values: c.values,
        };
    });
}
/** Each case's weight: 1/k per case, or 1/(F·n_f) per family. */
function weightsOf(cases, weighting) {
    if (weighting === "per-case")
        return cases.map(() => 1 / cases.length);
    const sizes = new Map();
    for (const c of cases)
        sizes.set(c.family, (sizes.get(c.family) ?? 0) + 1);
    return cases.map((c) => 1 / (sizes.size * sizes.get(c.family)));
}
const allEqual = (values) => values.every((v) => Math.abs(v - values[0]) <= 1e-12 * values[0]);
const withCoverage = (interval, coverage) => ({
    ...interval,
    coverage,
});
/**
 * The interval of the operational estimand: binary trials of equal weight give Clopper–Pearson
 * on the pooled count over planned trials, at the adjusted level (`pooledClopperPearson`); any other case gives Hoeffding's bound over the trials.
 */
function operationalOf(input, planned, weights, level, sided) {
    const trialWeights = planned.map((c, i) => weights[i] / c.planned);
    if (input.valueType === "binary" && allEqual(trialWeights)) {
        const successes = planned.reduce((a, c) => a + c.sum, 0);
        const trials = planned.reduce((a, c) => a + c.planned, 0);
        return withCoverage(pooledClopperPearson({ successes, trials }, level, sided), "conservative");
    }
    // Each planned trial is one term; a missing trial is a 0.
    const values = [];
    const termWeights = [];
    planned.forEach((c, i) => {
        for (let t = 0; t < c.planned; t++) {
            values.push(c.values[t] ?? 0);
            termWeights.push(trialWeights[i]);
        }
    });
    return withCoverage(hoeffding(values, termWeights, level, sided), "conservative");
}
/**
 * A one-arm estimate, by these rules.
 *
 * `these-cases`, from within-case variance only:
 * - one trial per case, binary, equal weights: Clopper–Pearson on the pooled count at the adjusted
 *   level, conservative for any rates (`pooledClopperPearson`);
 * - one trial per case, scores, equal weights: Wilson on the pooled mean, not validated;
 * - one trial per case, unequal weights (per family, families of different sizes): Hoeffding's
 *   bound, conservative;
 * - otherwise: the one-arm stratified score interval, not validated.
 *
 * `population`: BCa over the top clusters (families, else cases), with at least 30 clusters and a
 * declared frame, not validated.
 */
export function estimate(input) {
    const level = input.level ?? 0.95;
    const sided = input.sided ?? "two";
    const estimand = input.estimand ?? "these-cases";
    const weighting = input.weighting ?? "per-case";
    assertLevel(level);
    if (estimand === "population" && !input.population)
        throw new RangeError("a population estimate needs its frame statement and generator");
    const all = prepare(input);
    const planned = all.filter((c) => c.planned > 0);
    if (planned.length === 0)
        throw new RangeError("an estimate needs at least one planned trial");
    const plannedWeights = weightsOf(planned, weighting);
    const worstCase = {
        low: weightedMean(planned.map((c) => c.sum / c.planned), plannedWeights),
        high: weightedMean(planned.map((c) => (c.sum + c.planned - c.trials) / c.planned), plannedWeights),
    };
    const operational = operationalOf(input, planned, plannedWeights, level, sided);
    const observed = all.filter((c) => c.trials > 0);
    const weights = weightsOf(observed, weighting);
    const point = weightedMean(observed.map((c) => c.sum / c.trials), weights);
    const base = {
        valueType: input.valueType,
        estimand,
        weighting,
        cases: observed.length,
        missingCases: planned.length - observed.length,
        worstCase,
        operational,
    };
    const none = (reason, estimateValue) => ({
        ...base,
        estimate: estimateValue,
        interval: null,
        noInterval: reason,
    });
    if (observed.length === 0)
        return none("NO_VALUES", Number.NaN);
    if (estimand === "population") {
        const { frame, rng, resamples } = input.population;
        if (!frame)
            return none("NO_SAMPLING_FRAME", point);
        const groups = new Map();
        for (const c of observed)
            groups.set(c.family, [...(groups.get(c.family) ?? []), c.sum / c.trials]);
        if (groups.size < POPULATION_MIN_CLUSTERS)
            return none("FEWER_THAN_30_CLUSTERS", point);
        const clusters = [...groups].map(([id, caseMeans]) => ({ id, caseMeans }));
        const result = bcaInterval(clusters, weighting, rng, resamples, level, sided);
        const resampling = {
            algorithm: rng.algorithm,
            seed: rng.seed,
            resamples,
            clusters: clusters.length,
        };
        if (result.refusal !== undefined)
            return { ...none(result.refusal, point), resampling };
        return {
            ...base,
            estimate: point,
            interval: withCoverage(result.interval, "not-validated"),
            resampling,
        };
    }
    let interval;
    if (observed.every((c) => c.trials === 1)) {
        if (!allEqual(weights)) {
            const values = observed.map((c) => c.sum);
            interval = withCoverage(hoeffding(values, weights, level, sided), "conservative");
        }
        else if (input.valueType === "binary") {
            const successes = observed.reduce((a, c) => a + c.sum, 0);
            interval = withCoverage(pooledClopperPearson({ successes, trials: observed.length }, level, sided), "conservative");
        }
        else {
            interval = withCoverage(wilsonMean(point, observed.length, level, sided), "not-validated");
        }
    }
    else {
        const cells = observed.map((c, i) => ({ sum: c.sum, trials: c.trials, weight: weights[i] }));
        interval = withCoverage(oneArmScoreInterval(cells, level, sided), "not-validated");
    }
    if (interval.lower === interval.upper)
        return none("ZERO_WIDTH", point);
    return { ...base, estimate: point, interval };
}
//# sourceMappingURL=estimate.js.map