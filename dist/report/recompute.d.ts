import { type Decision, type GateResult, type MeasureValue, type Plan, type Run, type Trial } from "../contracts/index.ts";
/** The result of recomputing a stored decision. */
export interface RecomputeResult {
    /** Whether the recomputed decision equals the stored one. */
    readonly matches: boolean;
    /**
     * The top-level members of the decision whose recomputed value differs; empty when it matches.
     */
    readonly differences: readonly string[];
}
/**
 * Recomputes a decision from the stored primary records and compares it with the stored decision
 * (REQ-83). Any difference (a changed record, a different statistics version) fails.
 */
export declare function recompute(records: {
    readonly plan: Plan;
    readonly run: Run;
    readonly trials: readonly Trial[];
    readonly values: readonly MeasureValue[];
    readonly gates: readonly GateResult[];
    readonly decision: Decision;
}): Promise<RecomputeResult>;
//# sourceMappingURL=recompute.d.ts.map