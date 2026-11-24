import { decide } from "./decide.js";
/**
 * Decides a run: the verdict of the candidate against the base, from the plan and the run's
 * records. It is synchronous and pure: the same records and `decidedAt` give the same decision,
 * byte for byte, and it reads no clock, file or network. The decision records the plan's Ichnaea
 * version. Records that do not belong to the plan, arms that differ beyond what the plan varies,
 * and other broken records make the run INVALID.
 */
export function compare(plan, records, options) {
    return decide({
        plan,
        run: records.run,
        trials: records.trials,
        values: records.values,
        gates: records.gates,
        decidedAt: options.decidedAt,
        ichnaea: plan.ichnaea,
    });
}
//# sourceMappingURL=compare.js.map