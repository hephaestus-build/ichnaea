import type { MeasureValue } from "../contracts/records/measure.ts";
import type { Plan } from "../contracts/records/plan.ts";
import type { Decision } from "../contracts/records/decision.ts";
import type { Trial } from "../contracts/records/trial.ts";
type RunReduction = NonNullable<Decision["trialReduction"]>;
/** Applies the locked reduction to one arm, under REQ-20's binary outcome rules. */
export declare function runReduction(plan: Plan, recorded: readonly Trial[], values: readonly MeasureValue[]): RunReduction | undefined;
export {};
//# sourceMappingURL=trial-reduction.d.ts.map