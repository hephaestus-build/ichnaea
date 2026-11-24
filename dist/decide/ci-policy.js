/**
 * The exit code a CI policy gives a decision (REQ-26, REQ-27): 1 blocks, 0 lets the change pass.
 * PASS never blocks, and INVALID always does: it never maps to a pass (REQ-53).
 */
export function exitCode(decision, policy) {
    if (decision.verdict === "INVALID")
        return 1;
    if (decision.verdict === "PASS")
        return 0;
    const action = decision.verdict === null
        ? policy.onEstimateOnly
        : decision.verdict === "REGRESSION"
            ? policy.onRegression
            : decision.reasonCode === "DROP_IN_THESE_RUNS_ONLY"
                ? (policy.onRunDrop ?? policy.onInconclusive)
                : policy.onInconclusive;
    return action === "block" ? 1 : 0;
}
//# sourceMappingURL=ci-policy.js.map