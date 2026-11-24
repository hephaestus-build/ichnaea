import type { Decision } from "../contracts/records/decision.ts";
import type { MeasureValue } from "../contracts/records/measure.ts";
import type { Plan } from "../contracts/records/plan.ts";
import type { Trial } from "../contracts/records/trial.ts";
/** Count a case once if any fresh completed trial hit. A partly observed non-hit is missing. */
export declare function mustNeverCounts(plan: Plan, trials: readonly Trial[], values: readonly MeasureValue[]): Decision["mustNever"];
//# sourceMappingURL=must-never.d.ts.map