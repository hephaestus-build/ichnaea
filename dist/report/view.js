import { notComputedReason, } from "../contracts/index.js";
/** A number as reports show it: a percentage with one decimal, or a dash when undefined. */
export function percent(value) {
    if (typeof value !== "number")
        return value.nonFinite === "nan" ? "–" : value.nonFinite === "inf" ? "+∞" : "−∞";
    const rounded = Math.round(value * 1000) / 10;
    return `${Object.is(rounded, -0) ? "0.0" : rounded.toFixed(1)}%`;
}
/** A difference in percentage points with its sign. */
export function points(value) {
    if (typeof value !== "number")
        return percent(value);
    const rounded = Math.round(value * 1000) / 10;
    const magnitude = Math.abs(rounded).toFixed(1);
    // A true minus sign, as in the margin column.
    return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${magnitude} pts`;
}
/** The label of a bound that its comparison's non-inferiority result does not vouch for. */
export const NOT_VALIDATED = "(not validated)";
/** The start of a bound cell that has no bound; its reason follows in parentheses. */
export const NO_BOUND = "no bound";
/** Why a difference has no bound, in words, from what the record says about it. */
export function noBoundReason(difference) {
    if (typeof difference.estimate !== "number")
        return "an arm has no value to compare";
    if (difference.method === "descriptive (no interval)")
        return "descriptive only, no interval";
    return `the ${difference.method} method gives none`;
}
/**
 * A difference and its one-sided bound, or dashes when there is no interval to show. A bound is
 * labelled "not validated" unless the non-inferiority result is validated; the regression result
 * never vouches for it (decision 0015).
 */
function differenceCells(difference, nonInferiority) {
    // An estimate is never shown without its interval or a stated reason why there is none (REQ-129).
    if (typeof difference.lower !== "number")
        return {
            estimate: typeof difference.estimate === "number" ? points(difference.estimate) : "–",
            bound: `${NO_BOUND} (${noBoundReason(difference)})`,
        };
    return {
        estimate: points(difference.estimate),
        bound: `≥ ${points(difference.lower)}${nonInferiority.validated ? "" : ` ${NOT_VALIDATED}`}`,
    };
}
function powerRow(statement, p) {
    const common = {
        statement,
        measure: p.measure,
        cases: p.applicableCases,
        replicates: p.replicates,
        margin: `${(p.margin * 100).toFixed(1)} pts`,
    };
    if (!p.computed)
        return {
            ...common,
            floor: "–",
            mde: "not computed",
            reach: "unknown",
            assumption: notComputedReason(p),
        };
    return {
        ...common,
        floor: points(p.floor).replace("+", ""),
        mde: points(p.mde).replace("+", ""),
        reach: p.decidable ? "yes" : "no",
        assumption: p.assumption,
    };
}
const IMPUTATION = {
    "against-non-inferiority": "missing candidate trials fail, missing base trials pass",
    "against-regression": "missing candidate trials pass, missing base trials fail",
};
/**
 * Builds the view model from a decision record alone. It computes nothing new: every number comes
 * from the record (REQ-82, REQ-128).
 */
export function decisionView(decision, suite, lineage = []) {
    const verdict = decision.verdict ?? "ESTIMATE-ONLY";
    const level = Math.round((1 - decision.alpha) * 100);
    return {
        title: `Ichnaea decision: ${suite}`,
        verdict,
        claim: decision.scope,
        reason: decision.reason,
        method: decision.mode === "estimate-only"
            ? `Estimate-only (${decision.measures[0]?.estimand ?? "fixed-cases"}): no statistical verdict. Rates carry 95% Wilson intervals; differences carry one-sided ${level}% lower bounds and are descriptive.`
            : `Estimand ${decision.measures[0]?.estimand ?? "fixed-cases"}; one-sided ${level}% lower bounds for differences (candidate minus base); intersection-union over primary measures; Holm across regression tests.`,
        measures: decision.measures.map((m) => {
            const comparison = m.comparisons[0];
            return {
                measure: m.measure,
                tier: m.tier,
                verdict: m.verdict,
                arms: m.arms.map((a) => ({
                    arm: a.arm,
                    rate: percent(a.rate.estimate),
                    interval: `${percent(a.rate.lower)} to ${percent(a.rate.upper)}`,
                    n: `${a.availability.available} of ${a.availability.planned}`,
                    missing: a.availability.missing,
                })),
                ...(comparison
                    ? {
                        difference: {
                            ...differenceCells(comparison.difference, comparison.nonInferiority),
                            // A secondary measure has no margin: it is descriptive.
                            margin: m.tier === "secondary"
                                ? "–"
                                : `−${(comparison.margin * 100).toFixed(1)} pts${comparison.safetyMargin > 0 ? ` (safety ${(comparison.safetyMargin * 100).toFixed(1)})` : ""}`,
                            method: comparison.difference.method,
                            negativeFlips: comparison.flips.filter((f) => f.direction === "negative").length,
                            positiveFlips: comparison.flips.filter((f) => f.direction === "positive").length,
                            validated: comparison.nonInferiority.validated,
                            ...(typeof comparison.difference.estimate === "number" &&
                                typeof comparison.difference.lower === "number"
                                ? {
                                    axis: {
                                        estimate: comparison.difference.estimate,
                                        lower: comparison.difference.lower,
                                        margin: comparison.margin,
                                        validated: comparison.nonInferiority.validated,
                                    },
                                }
                                : {}),
                        },
                    }
                    : {}),
                notes: m.notes,
            };
        }),
        gates: decision.gates.map((g) => ({
            gate: g.gate,
            result: g.passed ? "passed" : `failed (${g.failures})`,
        })),
        flips: decision.measures.flatMap((m) => (m.comparisons[0]?.flips ?? []).map((f) => ({
            measure: m.measure,
            case: f.case,
            direction: f.direction,
            base: percent(f.base),
            candidate: percent(f.candidate),
        }))),
        power: [
            ...decision.power.planning.map((p) => powerRow("planning", p)),
            ...decision.power.run.map((p) => powerRow("this run", p)),
        ],
        sensitivity: decision.measures
            .flatMap((m) => m.sensitivity.map((s) => ({
            measure: m.measure,
            imputation: IMPUTATION[s.imputation] ?? s.imputation,
            ...differenceCells(s.difference, s.nonInferiority),
            validated: s.nonInferiority.validated,
            verdict: s.verdict,
            changes: s.changesVerdict ? "yes" : "no",
        })))
            .map(({ estimate, ...rest }) => ({ ...rest, difference: estimate })),
        missingness: `${decision.missingness.byArm.map((a) => `${a.arm}: ${a.missing} of ${a.planned} trials missing`).join("; ")}. ${decision.missingness.sensitivity === "not-needed"
            ? "No primary measure misses a trial in either arm, so no sensitivity analysis ran."
            : `A primary measure misses trials, so each verdict was decided again with the missing trials imputed against it: for non-inferiority, missing candidate trials fail and missing base trials pass; for regression, the reverse. ${decision.missingness.sensitivity === "unchanged"
                ? "No verdict changes."
                : "A verdict changes, and that measure is INCONCLUSIVE."}`}`,
        differingFactors: decision.differingFactors,
        limitations: decision.limitations,
        lineage: [
            ["Run", decision.run],
            ["Plan", decision.plan],
            ["Run record", decision.runDigest],
            ...decision.arms.map((a) => [
                `Arm ${a.name} (${a.role})`,
                a.identity,
            ]),
            ...decision.measures.map((m) => [
                `Measure ${m.measure}`,
                m.version,
            ]),
            ...lineage
                .filter((l) => l.kind !== "measure")
                .map((l) => [
                `${l.kind[0]?.toUpperCase() ?? ""}${l.kind.slice(1)} ${l.id}`,
                l.digest ? `${l.version} (${l.digest})` : l.version,
            ]),
            ["Seed", `${decision.seed.algorithm} ${decision.seed.value}`],
            ["Ichnaea", decision.ichnaea],
            ["Decided", decision.decidedAt],
        ],
    };
}
//# sourceMappingURL=view.js.map