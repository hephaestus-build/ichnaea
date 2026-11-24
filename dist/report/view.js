import { resolutionLine } from "../plan/resolution.js";
import { notComputedReason } from "../contracts/records/plan.js";
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
function reductionView(reduction, id) {
    const cells = (row) => row.status === "missing"
        ? ["Missing", "Missing", "missing"]
        : [percent(row.passAll), percent(row.passAny), row.status];
    const observed = reduction.cases.filter((row) => row.status !== "missing").length;
    return {
        measure: id(reduction.measure),
        k: reduction.k,
        rows: [
            ...reduction.cases.map((row) => [id(row.case), `${row.validTrials} of ${row.plannedTrials}`, ...cells(row)]),
            ["Overall", `${observed} of ${reduction.cases.length} cases`, ...cells(reduction.overall)],
        ],
    };
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
function powerRow(statement, p, id, prose) {
    const common = {
        statement,
        measure: id(p.measure),
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
            assumption: prose(notComputedReason(p)),
        };
    return {
        ...common,
        floor: points(p.floor).replace("+", ""),
        mde: points(p.mde).replace("+", ""),
        reach: p.decidable ? "yes" : "no",
        assumption: prose(p.assumption),
    };
}
const IMPUTATION = {
    "against-non-inferiority": "missing candidate trials fail, missing base trials pass",
    "against-regression": "missing candidate trials pass, missing base trials fail",
};
/** A decision quotes each identifier it names in its prose: `'<id>'`, in the identifier grammar. */
const QUOTED_ID = /'[A-Za-z0-9][A-Za-z0-9._:/@+-]*'/g;
/**
 * Builds the view model from a decision record alone. It computes nothing new: every number comes
 * from the record (REQ-82, REQ-128).
 */
export function decisionView(decision, suite, lineage = [], options = {}) {
    const neutral = options.neutral === true;
    const id = (value) => (neutral ? "id" : value);
    const prose = (text) => (neutral ? text.replaceAll(QUOTED_ID, "'id'") : text);
    // An arm with an opaque name (`a`, `b`) is shown with its role, so a reader knows its side.
    const armLabel = (name) => {
        const role = decision.arms.find((a) => a.name === name)?.role;
        return role === undefined || role === name ? id(name) : `${role} (${id(name)})`;
    };
    const verdict = decision.verdict ?? "ESTIMATE-ONLY";
    const level = Math.round((1 - decision.alpha) * 100);
    const lineageRows = [
        ["Run", decision.run],
        ["Plan", decision.plan],
        ["Run record", decision.runDigest],
        ...decision.arms.map((a) => [
            `Arm ${a.name} (${a.role})`,
            a.identity,
        ]),
        ...decision.measures.map((m) => [`Measure ${m.measure}`, m.version]),
        ...lineage
            .filter((l) => l.kind !== "measure")
            .map((l) => [
            `${l.kind[0]?.toUpperCase() ?? ""}${l.kind.slice(1)} ${l.id}`,
            l.digest ? `${l.version} (${l.digest})` : l.version,
        ]),
        ["Seed", `${decision.seed.algorithm} ${decision.seed.value}`],
        ["Ichnaea", decision.ichnaea],
        ["Decided", decision.decidedAt],
    ];
    return {
        title: `Ichnaea decision: ${id(suite)}`,
        verdict,
        claim: prose(decision.scope),
        reason: prose(decision.reason),
        method: decision.mode === "estimate-only"
            ? `Estimate-only (${decision.measures[0]?.estimand ?? "fixed-cases"}): no statistical verdict. Rates give cases equal weight; differences carry one-sided ${level}% lower bounds and are descriptive.`
            : `Estimand ${decision.measures[0]?.estimand ?? "fixed-cases"}; one-sided ${level}% lower bounds for differences (candidate minus base); Holm adjustment for within-run drop tests.`,
        measures: decision.measures.map((m) => {
            const comparison = m.comparisons[0];
            return {
                measure: id(m.measure),
                tier: m.tier,
                verdict: m.verdict,
                estimand: m.estimand,
                arms: m.arms.map((a) => ({
                    arm: armLabel(a.arm),
                    rate: percent(a.rate.estimate),
                    interval: typeof a.rate.lower === "number" && typeof a.rate.upper === "number"
                        ? `${percent(a.rate.lower)} to ${percent(a.rate.upper)}${a.intervalValidity?.validated === false ? ` ${NOT_VALIDATED}` : ""}`
                        : "No interval yet: the available trials do not give one.",
                    n: `${a.availability.available} of ${a.availability.planned}`,
                    missing: a.availability.missing,
                    denominators: {
                        observedCases: a.caseAvailability?.observed ?? null,
                        plannedCases: a.caseAvailability?.planned ?? null,
                        observedTrials: a.availability.available,
                        plannedTrials: a.availability.planned,
                        ...(a.caseAvailability
                            ? {}
                            : { caseCountsReason: "the decision predates case counts" }),
                    },
                    estimand: "equal-weight observed cases",
                    method: a.rate.method,
                    level: a.rate.level,
                    sidedness: a.rate.sided,
                    validity: a.intervalValidity ?? {
                        validated: false,
                        limitations: ["the decision records no interval validity"],
                    },
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
                            sidedness: comparison.difference.sided,
                            level: comparison.difference.level,
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
                ...(m.blocks ? { blocks: m.blocks } : {}),
                ...(m.noise
                    ? {
                        noise: {
                            ...m.noise,
                            arms: m.noise.arms.map((a) => ({ ...a, arm: armLabel(a.arm) })),
                        },
                    }
                    : {}),
                notes: m.notes.map(prose),
            };
        }),
        ...(decision.trialReduction
            ? { trialReduction: reductionView(decision.trialReduction, id) }
            : {}),
        ...(decision.mustNever
            ? {
                mustNever: decision.mustNever.map((entry) => ({
                    measure: id(entry.measure),
                    note: `${entry.detector === "model" ? "Model flags" : "Deterministic detector hits"}. Scope: ${id(entry.scope)}. Counts use fresh trials.`,
                    counts: [entry.planned, entry.clean, entry.hits, entry.missing],
                    details: [
                        ...entry.controls.map((control) => `${id(control.pattern)} positive control (${id(control.case)}): ${control.status}.`),
                        ...entry.cases.map((row) => `${id(row.case)}: ${row.status}, ${row.observed} of ${row.planned} trials scored; contexts ${row.contexts.map(id).join(", ") || "unavailable"}.`),
                        ...entry.windows.map((window) => `Block ${window.block}: ${window.startedAt} to ${window.endedAt}.`),
                        ...(entry.windows.length === 0
                            ? ["Block windows unavailable."]
                            : [
                                "Back-to-back blocks protect against instance, cache and sandbox state. They protect against a provider shock to one arm only when the blocks are spread in time.",
                            ]),
                    ],
                })),
            }
            : {}),
        gates: decision.gates.map((g) => ({
            gate: id(g.gate),
            result: g.passed ? "passed" : `failed (${g.failures})`,
        })),
        flips: decision.measures.flatMap((m) => (m.comparisons[0]?.flips ?? []).map((f) => ({
            measure: id(m.measure),
            case: id(f.case),
            direction: f.direction,
            base: percent(f.base),
            candidate: percent(f.candidate),
        }))),
        power: decision.resolution === undefined
            ? [
                ...decision.power.planning.map((p) => powerRow("planning", p, id, prose)),
                ...decision.power.run.map((p) => powerRow("this run", p, id, prose)),
            ]
            : [],
        resolution: (decision.resolution ?? []).map((entry) => prose(resolutionLine(entry, id(entry.measure)))),
        sensitivity: decision.measures
            .flatMap((m) => m.sensitivity.map((s) => ({
            measure: id(m.measure),
            imputation: IMPUTATION[s.imputation] ?? s.imputation,
            ...differenceCells(s.difference, s.nonInferiority),
            validated: s.nonInferiority.validated,
            verdict: s.verdict,
            changes: s.changesVerdict ? "yes" : "no",
        })))
            .map(({ estimate, ...rest }) => ({ ...rest, difference: estimate })),
        missingness: `${decision.missingness.byArm.map((a) => `${armLabel(a.arm)}: ${a.missing} of ${a.planned} trials missing`).join("; ")}. ${decision.missingness.sensitivity === "not-needed"
            ? "No primary measure misses a trial in either arm, so no sensitivity analysis ran."
            : `A primary measure misses trials, so each verdict was decided again with the missing trials imputed against it: for non-inferiority, missing candidate trials fail and missing base trials pass; for regression, the reverse. ${decision.missingness.sensitivity === "unchanged"
                ? "No verdict changes."
                : "A verdict changes, and that measure is INCONCLUSIVE."}`}`,
        differingFactors: decision.differingFactors.map(id),
        limitations: [
            "Ichnaea can show that a change failed a hard gate, or dropped within these runs. It cannot yet show a regression across runs, or that a change is safe.",
            ...decision.limitations.map(prose),
        ],
        lineage: lineageRows.map(([label, value]) => [id(label), id(value)]),
    };
}
//# sourceMappingURL=view.js.map