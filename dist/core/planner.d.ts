import type { Plan } from "../contracts/records/plan.ts";
import { type PreparedPlanInput } from "../plan/resolve.ts";
import type { GateDefinition, MeasureDefinition } from "./plugin.ts";
export { MIN_DECISION_CASES, PlanError } from "../plan/resolve.ts";
/** Everything needed to resolve a suite and run the examples of its primary measures. */
export interface PlanInput extends Omit<PreparedPlanInput, "measures" | "gates" | "tested"> {
    /** The measures that the configuration defines, by card ID. */
    readonly measures: ReadonlyMap<string, MeasureDefinition>;
    /** The gates that the configuration defines, by gate ID. */
    readonly gates: ReadonlyMap<string, GateDefinition>;
    /** Directory of declared scorer files. Defaults to the working directory. */
    readonly directory?: string;
}
/** Qualifies inline measures and resolves the plan from their cards and tester results. */
export declare function createPlan(input: PlanInput): Promise<Plan>;
//# sourceMappingURL=planner.d.ts.map