import type { Decision } from "../contracts/records/decision.ts";
import type { Plan } from "../contracts/records/plan.ts";
/**
 * The exit code a CI policy gives a decision (REQ-26, REQ-27): 1 blocks, 0 lets the change pass.
 * PASS never blocks, and INVALID always does: it never maps to a pass (REQ-53).
 */
export declare function exitCode(decision: Decision, policy: Plan["policy"]): number;
//# sourceMappingURL=ci-policy.d.ts.map