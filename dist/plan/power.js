import { VALIDATED_MARGIN_CEILING, VALIDATED_MARGIN_FLOOR } from "../stats/compare.js";
import { sampledCasesFloor, zeroNoiseFloor } from "../stats/power.js";
/** Planned trials per case in one arm (a suite can give some cases more, `replicatesFor`). */
export function plannedTrialsPerCase(plan, arm) {
    const counts = new Map();
    for (const t of plan.trials)
        if (t.arm === arm)
            counts.set(t.case, (counts.get(t.case) ?? 0) + 1);
    return counts;
}
/** "2 (43 cases), 3 (17 cases)": the trial counts per case and arm, for power statements. */
export function describeCounts(counts) {
    const by = new Map();
    for (const c of counts)
        by.set(c, (by.get(c) ?? 0) + 1);
    return [...by.entries()]
        .toSorted(([a], [b]) => a - b)
        .map(([r, n]) => `${r} (${n} case${n === 1 ? "" : "s"})`)
        .join(", ");
}
/**
 * The planning power statement (REQ-27, REQ-54): per primary measure, the zero-noise floor of the
 * fixed-cases bound for the plan's cases and trials. The floor is a lower bound on the minimum
 * detectable effect, so a margin below it can never be shown: the plan then runs estimate-only.
 * This statement, made before any call, is the only one that may switch a plan to estimate-only.
 *
 * Under fixed-cases, a primary measure whose effective margin (the declared margin less its safety
 * margin, which is what the comparison tests) lies outside the validated margins of the statistics
 * package is refused (decision 0012): below the floor no non-inferiority result is validated, and a
 * margin of 0 is no non-inferiority test at all; above the ceiling the validation studies do not
 * reach. Every declared margin is checked, a placeholder too, so a margin that can never decide is
 * refused before any call. Another estimand's method states its own validated domain.
 *
 * Every plan gets the statement, an estimate-only plan too (a placeholder margin, one trial per
 * case, sampled-cases), because its decision carries it and explains with it why no verdict was
 * possible. Under fixed-cases with fewer than 2 trials in a case, each entry says why it is not
 * computed.
 */
export function planningPower(plan) {
    for (const p of plan.estimand === "fixed-cases" ? plan.primary : []) {
        const tested = p.margin - (p.safetyMargin ?? 0);
        const broken = tested < VALIDATED_MARGIN_FLOOR
            ? `below the validated margin floor of ${VALIDATED_MARGIN_FLOOR}`
            : tested > VALIDATED_MARGIN_CEILING
                ? `above the validated margin ceiling of ${VALIDATED_MARGIN_CEILING}`
                : undefined;
        if (broken)
            return {
                refuse: `primary measure '${p.measure}': its margin of ${p.margin} less its safety margin of ${p.safetyMargin ?? 0} is ${broken}, where no non-inferiority result is validated`,
            };
    }
    const base = plan.arms.find((a) => a.role === "base")?.name ?? plan.arms[0]?.name ?? "";
    const counts = [...plannedTrialsPerCase(plan, base).values()];
    if (counts.length === 0)
        return {};
    const common = (p) => ({
        measure: p.measure,
        applicableCases: counts.length,
        replicates: Math.min(...counts),
        margin: p.margin,
    });
    if (plan.estimand === "sampled-cases") {
        // No sampled-cases method is validated yet, so such a plan is estimate-only already; the
        // statement still says what its cases could detect at best.
        const floor = sampledCasesFloor(counts.length, plan.alpha);
        return {
            power: plan.primary.map((p) => ({
                computed: true,
                ...common(p),
                mde: floor,
                floor,
                sampledCasesFloor: floor,
                assumption: "planning: no discordant pairs, every case applicable (a lower bound on the MDE)",
                decidable: floor < p.margin - (p.safetyMargin ?? 0),
            })),
        };
    }
    if (Math.min(...counts) < 2)
        return {
            power: plan.primary.map((p) => ({
                computed: false,
                ...common(p),
                reason: "fixed-cases needs at least 2 trials per case and arm",
            })),
        };
    const floor = zeroNoiseFloor(counts, plan.alpha);
    const reasons = [];
    const power = plan.primary.map((p) => {
        const effective = p.margin - (p.safetyMargin ?? 0);
        const decidable = floor < effective;
        if (!decidable)
            reasons.push(`measure '${p.measure}': the zero-noise floor of ${(floor * 100).toFixed(1)} points is not below the margin of ${(effective * 100).toFixed(1)} points, so no run of this plan can show it non-inferior`);
        return {
            computed: true,
            ...common(p),
            mde: floor,
            floor,
            sampledCasesFloor: sampledCasesFloor(counts.length, plan.alpha),
            assumption: `planning: no noise, every case applicable, trials per case ${describeCounts(counts)} (a lower bound on the MDE)`,
            decidable,
        };
    });
    // Only a plan in decision mode is switched; an estimate-only plan keeps its own reasons.
    return reasons.length > 0 && plan.mode === "decision"
        ? { power, mode: "estimate-only", modeReasons: [...plan.modeReasons, ...reasons] }
        : { power };
}
//# sourceMappingURL=power.js.map