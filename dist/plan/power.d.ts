import type { Plan } from "../contracts/records/plan.ts";
/** Planned trials per case in one arm (a suite can give some cases more, `replicatesFor`). */
export declare function plannedTrialsPerCase(plan: Plan, arm: string): Map<string, number>;
/** "2 (43 cases), 3 (17 cases)": the trial counts per case and arm, for power statements. */
export declare function describeCounts(counts: readonly number[]): string;
/** What the planning power calculation adds to a plan. */
export type PlanPowerStatement = Partial<Pick<Plan, "power" | "modeReasons">> & {
    readonly mode?: "estimate-only";
    readonly refuse?: string;
};
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
export declare function planningPower(plan: Plan): PlanPowerStatement;
//# sourceMappingURL=power.d.ts.map