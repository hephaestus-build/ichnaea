import { createRng } from "../stats/index.js";
import { bootstrapCalibration, calibrated, estimates, } from "./engine.js";
/** The registered rule's defaults. */
export const CALIBRATION_DEFAULTS = {
    agreementTolerance: 0.15,
    rateTolerance: 0.1,
    raterFloor: { ac1: 0.6, alpha: 0.667 },
    armBiasMargin: { binary: 0.2, levels: 0.15 },
    resamples: 2000,
};
const CONFIGURATIONS = { base: 0, candidate: 1, "known-worse": 2 };
/** The set in columns, after checking it. */
function columns(input) {
    const levels = input.scale === "levels" ? input.levels : 2;
    if (input.scale === "levels" && !(Number.isInteger(levels) && levels >= 2)) {
        throw new RangeError(`levels must be an integer of at least 2, got ${levels}`);
    }
    const valid = (label) => input.scale === "binary"
        ? label === 0 || label === 1
        : Number.isInteger(label) && label >= 1 && label <= levels;
    const items = new Map();
    const strata = new Map();
    const stratumOf = [];
    const stratumName = [];
    const seen = new Set();
    for (const unit of input.units) {
        if (!(Number.isFinite(unit.weight) && unit.weight >= 1)) {
            throw new RangeError(`${unit.item}: a weight is 1/π, at least 1, got ${unit.weight}`);
        }
        if (input.scale === "levels" && unit.weight !== 1) {
            throw new RangeError(`${unit.item}: levels take no weight other than 1, because ordinal alpha takes none`);
        }
        for (const label of [...unit.raters, unit.judge]) {
            if (!valid(label))
                throw new RangeError(`${unit.item}: the label ${label} is outside the scale`);
        }
        if (!items.has(unit.item)) {
            items.set(unit.item, items.size);
            if (!strata.has(unit.stratum))
                strata.set(unit.stratum, strata.size);
            stratumOf.push(strata.get(unit.stratum));
            stratumName.push(unit.stratum);
        }
        else if (stratumName[items.get(unit.item)] !== unit.stratum) {
            throw new RangeError(`${unit.item}: every answer of an item is in one stratum`);
        }
        seen.add(CONFIGURATIONS[unit.configuration]);
    }
    if (!seen.has(0) || !seen.has(1)) {
        throw new RangeError("a calibration set needs answers from both base and candidate");
    }
    return {
        scale: input.scale,
        levels,
        cases: items.size,
        caseOf: input.units.map((u) => items.get(u.item)),
        configurationOf: input.units.map((u) => CONFIGURATIONS[u.configuration]),
        weight: input.units.map((u) => u.weight),
        stratumOf,
        first: input.units.map((u) => u.raters[0]),
        second: input.units.map((u) => u.raters[1]),
        judge: input.units.map((u) => u.judge),
    };
}
/** A rate of the judge and of the raters, with the gap's bound, when the scale has it. */
function paired(estimate, condition) {
    return estimate === undefined || condition === undefined
        ? undefined
        : {
            ...estimate,
            gap: { estimate: estimate.judge - estimate.humanHuman, lower: condition.lower },
        };
}
/**
 * Analyzes a calibration set under the calibration rule. A judge is `calibrated` when every
 * condition holds:
 * - the rater floor: the lower bound of rater–rater agreement reaches AC1 0.60 (yes/no) or ordinal
 *   alpha 0.667 (levels);
 * - D: the lower bound of judge–rater minus rater–rater agreement is at least −0.15;
 * - for yes/no labels, the lower bounds of the sensitivity gap and of the specificity gap are each
 *   at least −0.10;
 * - the bias gate: the 90 % interval of the judge's bias between base and candidate lies within
 *   ±0.20 (yes/no) or ±0.15 (levels). A judge whose bias between the two is not ruled out makes
 *   its measured changes uninterpretable, so the gate holds for a secondary measure too.
 * Lower bounds are one-sided 95 % percentile bounds of a bootstrap that resamples whole items within
 * their strata, and every statistic weights each answer by 1/π. A calibrated judge's measures are
 * secondary: they are shown and never decide.
 */
export function analyzeCalibration(input, settings) {
    const values = {
        agreementTolerance: settings.agreementTolerance ?? CALIBRATION_DEFAULTS.agreementTolerance,
        rateTolerance: settings.rateTolerance ?? CALIBRATION_DEFAULTS.rateTolerance,
        raterFloor: settings.raterFloor ?? CALIBRATION_DEFAULTS.raterFloor,
        armBiasMargin: settings.armBiasMargin ?? CALIBRATION_DEFAULTS.armBiasMargin,
        resamples: settings.resamples ?? CALIBRATION_DEFAULTS.resamples,
    };
    if (!(Number.isInteger(values.resamples) && values.resamples >= 1)) {
        throw new RangeError(`resamples must be a positive integer, got ${values.resamples}`);
    }
    const set = columns(input);
    const boot = bootstrapCalibration(set, values, createRng(settings.seed));
    const point = estimates(set);
    const sum = set.weight.reduce((a, w) => a + w, 0);
    const sumSquares = set.weight.reduce((a, w) => a + w * w, 0);
    const c = boot.conditions;
    const conditions = {
        ratersFloor: {
            ...c.ratersFloor,
            floor: values.raterFloor[set.scale === "levels" ? "alpha" : "ac1"],
        },
        agreement: { ...c.agreement, tolerance: values.agreementTolerance },
        ...(c.sensitivity === undefined
            ? {}
            : { sensitivity: { ...c.sensitivity, tolerance: values.rateTolerance } }),
        ...(c.specificity === undefined
            ? {}
            : { specificity: { ...c.specificity, tolerance: values.rateTolerance } }),
        armBias: {
            ...c.armBias,
            shownBound: boot.armBias.shownBound,
            margin: values.armBiasMargin[set.scale === "levels" ? "levels" : "binary"],
        },
    };
    const order = [
        "ratersFloor",
        "agreement",
        "sensitivity",
        "specificity",
        "armBias",
    ];
    const failed = order.filter((name) => conditions[name] !== undefined && !conditions[name].holds);
    const sensitivity = paired(point.sensitivity, c.sensitivity);
    const specificity = paired(point.specificity, c.specificity);
    return {
        statistic: set.scale === "levels" ? "krippendorff-alpha-ordinal" : "gwet-ac1",
        units: set.caseOf.length,
        items: set.cases,
        effectiveUnits: (sum * sum) / sumSquares,
        humanHuman: { estimate: point.humanHuman, lower: c.ratersFloor.lower },
        judgeHuman: { estimate: point.judgeHuman },
        difference: { estimate: point.judgeHuman - point.humanHuman, lower: c.agreement.lower },
        ...(sensitivity === undefined ? {} : { sensitivity }),
        ...(specificity === undefined ? {} : { specificity }),
        armBias: boot.armBias,
        ...(boot.slope === undefined
            ? {}
            : { slope: { ...boot.slope, dropShown: boot.slope.humanChangeUpper < 0 } }),
        conditions,
        status: calibrated(boot) ? "calibrated" : "diagnostic",
        failed,
        use: "secondary",
        undefinedResamples: boot.undefinedResamples,
        resamples: values.resamples,
    };
}
/**
 * Whether a judge-based Pass is reachable at a measure's limit, and the bound it would need. A Pass
 * needs the judge-measured change's lower bound to be at least −(β_L · limit − B), with β_L the
 * slope's lower bound and B the bias bound on the calibration's base against known-worse pair. It
 * is blocked when the judge is not calibrated, without known-worse answers, when the human drop on
 * that pair is not shown, or when β_L · limit ≤ B. Even when it is reachable, a calibrated judge's
 * measures stay secondary in this version.
 */
export function judgePass(analysis, limit) {
    const slope = analysis.slope;
    const blockedBy = analysis.status === "calibrated" ? [] : ["notCalibrated"];
    if (slope === undefined) {
        return {
            reachable: false,
            lowerBoundAtLeast: undefined,
            blockedBy: [...blockedBy, "noKnownWorse"],
        };
    }
    const margin = slope.lower * limit - slope.pairBound;
    if (!slope.dropShown)
        blockedBy.push("dropNotShown");
    if (!(margin > 0))
        blockedBy.push("slopeNotShown");
    return { reachable: blockedBy.length === 0, lowerBoundAtLeast: -margin, blockedBy };
}
//# sourceMappingURL=analyze.js.map