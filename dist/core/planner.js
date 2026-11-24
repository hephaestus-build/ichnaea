import { resolvePlan } from "../plan/resolve.js";
import { testMeasure } from "./measures.js";
export { MIN_DECISION_CASES, PlanError } from "../plan/resolve.js";
/** Qualifies inline measures and resolves the plan from their cards and tester results. */
export async function createPlan(input) {
    const tested = new Set();
    for (const { measure } of input.suite.primary) {
        const definition = input.measures.get(measure);
        if (definition?.card.computedBy === "ichnaea" &&
            (await testMeasure(definition)).status === "passed")
            tested.add(measure);
    }
    return resolvePlan({
        ...input,
        measures: new Map([...input.measures].map(([id, definition]) => [id, definition.card])),
        gates: new Set(input.gates.keys()),
        tested,
    });
}
//# sourceMappingURL=planner.js.map