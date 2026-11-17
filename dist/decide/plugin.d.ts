import type { Decision } from "../contracts/records/decision.ts";
import type { Plan } from "../contracts/records/plan.ts";
import type { Plugin } from "../core/plugin.ts";
/**
 * The exit code a CI policy gives a decision (REQ-26, REQ-27): 1 blocks, 0 lets the change pass.
 * PASS never blocks, and INVALID always does: it never maps to a pass (REQ-53).
 */
export declare function exitCode(decision: Decision, policy: Plan["policy"]): number;
/** The decision plugin: the `decide` command over the record store. */
export declare function decidePlugin(): Plugin<"decide">;
//# sourceMappingURL=plugin.d.ts.map