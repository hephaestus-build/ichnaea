import { adjustedTail } from "./adjusted-tail.js";
import { pooledClopperPearson } from "./clopper-pearson.js";
import { assertLevel } from "./types.js";
function check(ceiling, confidence, detector) {
    if (!(ceiling > 0 && ceiling < 1))
        throw new RangeError(`the ceiling must be in (0, 1), got ${ceiling}`);
    assertLevel(confidence);
    if (detector.kind === "model" && detector.sensitivityLower !== null) {
        const s = detector.sensitivityLower;
        if (!(Number.isFinite(s) && s >= 0 && s <= 1))
            throw new RangeError(`a sensitivity bound must be in [0, 1], got ${s}`);
    }
}
/** A model detector splits the level between its two bounds (Bonferroni), so the claim keeps it. */
const boundLevel = (confidence, detector) => detector.kind === "model" ? 1 - (1 - confidence) / 2 : confidence;
/**
 * The must-never ceiling claim. A deterministic detector bounds the violation rate by the one-sided
 * Clopper–Pearson upper bound on the pooled count of violating cases at the adjusted level
 * (`pooledClopperPearson`), which holds when cases violate at unequal rates, at the full confidence. A calibrated model detector divides
 * that bound, at 1 − (1 − confidence)/2, by the lower bound on its sensitivity, taken at the same
 * level, so that the two bounds hold jointly at the confidence. Its false positives only make the
 * claim conservative. The claim is conservative for any rates, so it is validated.
 */
export function neverClaim(input) {
    const { violations, cases, ceiling, confidence, detector } = input;
    check(ceiling, confidence, detector);
    if (!(Number.isInteger(cases) && cases >= 1))
        throw new RangeError(`${cases} cases is not positive`);
    const method = "clopper-pearson-adjusted";
    const level = boundLevel(confidence, detector);
    if (detector.kind === "model" && detector.sensitivityLower === null) {
        const diagnostic = pooledClopperPearson({ successes: violations, trials: cases }, confidence, "upper");
        return {
            status: "flagged-only",
            bound: diagnostic.upper,
            level: confidence,
            reason: "NO_DETECTOR_CALIBRATION",
            method,
        };
    }
    const sensitivity = detector.kind === "model" ? detector.sensitivityLower : 1;
    if (sensitivity === 0)
        return { status: "no-claim", bound: null, level, reason: "SENSITIVITY_NOT_BOUNDED", method };
    const flagged = pooledClopperPearson({ successes: violations, trials: cases }, level, "upper").upper;
    const bound = Math.min(1, flagged / sensitivity);
    return { status: bound <= ceiling ? "shown" : "not-shown", bound, level, method };
}
/**
 * The fewest cases, all clean, that show the ceiling: ⌈ln α′ / ln(1 − ceiling·Se_L)⌉ with α′ the
 * adjusted level 1 − e^{−α} of the bound's own α (the full α for a deterministic detector, α/2 for a
 * model detector), as `pooledClopperPearson` takes it, and
 * Se_L = 1 for a deterministic detector. It is checked against the claim itself, so it is the
 * smallest n whose claim holds. A model detector without a calibration record, or with Se_L = 0,
 * gets no count and the reason instead.
 */
export function neverCasesNeeded(input) {
    const { ceiling, confidence, detector } = input;
    check(ceiling, confidence, detector);
    if (detector.kind === "model" && detector.sensitivityLower === null)
        return { cases: null, reason: "NO_DETECTOR_CALIBRATION" };
    const sensitivity = detector.kind === "model" ? detector.sensitivityLower : 1;
    if (sensitivity === 0)
        return { cases: null, reason: "SENSITIVITY_NOT_BOUNDED" };
    const tail = adjustedTail(boundLevel(confidence, detector), "upper");
    const target = ceiling * sensitivity;
    // The closed form can sit off where the logarithms round; the claim decides. The smallest count
    // whose claim holds lies in (low, high]. Both searches are bounded: near a target of 2^−53 the
    // claim's arithmetic stops resolving counts, and a target that underflows to 0 has none.
    const holds = (k) => 1 - tail ** (1 / k) <= target;
    let low = 0;
    let high = Math.max(1, Math.ceil(Math.log(tail) / Math.log1p(-target)));
    for (let i = 0; i < 64 && !holds(high); i++)
        [low, high] = [high, 2 * high];
    for (let i = 0; i < 64 && high - low > 1; i++) {
        const mid = Math.floor((low + high) / 2);
        if (holds(mid))
            high = mid;
        else
            low = mid;
    }
    if (!(Number.isSafeInteger(high) && high - low === 1))
        throw new RangeError(`no count of cases up to 2^53 shows the ceiling ${ceiling}`);
    return { cases: high };
}
//# sourceMappingURL=never.js.map