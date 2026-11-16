import * as z from "zod";
import { none } from "../data-class.js";
import { CalendarDate, CaseSetId, Digest, GateId, MeasureId, Probability, SuiteId, Text, } from "../primitives.js";
/** The question an estimate answers (REQ-49). */
export const Estimand = z.enum(["fixed-cases", "sampled-cases"]);
/** What a CI policy does with a verdict that is not PASS (REQ-26, REQ-27). */
export const PolicyAction = z.enum(["block", "report"]);
/**
 * The CI policy of a suite. INCONCLUSIVE and estimate-only must have a stated action (REQ-27). An
 * INVALID run always blocks, so it has no action to choose: INVALID never maps to a pass (REQ-53).
 */
export const CiPolicy = z.strictObject({
    onRegression: none(PolicyAction),
    onInconclusive: none(PolicyAction),
    onEstimateOnly: none(PolicyAction),
});
/** The run budget (REQ-21). */
export const Budget = z.strictObject({
    maxCalls: none(z.int().min(0)),
    callsPerTrial: none(z.int().min(1)),
    maxCost: none(z.number().min(0)).optional(),
    costUnit: none(Text).optional(),
});
/**
 * Whether a margin is registered by the measure's owner, or a placeholder. A placeholder margin
 * gives no verdict: the plan runs estimate-only (decision 0012).
 */
export const MarginStatus = z.enum(["registered", "placeholder"]);
/** A primary measure with its margin and optional safety margin. */
export const PrimaryMeasure = z.strictObject({
    measure: none(MeasureId),
    margin: none(z.number().min(0)),
    marginStatus: none(MarginStatus),
    marginReason: none(Text),
    safetyMargin: none(z.number().min(0)).optional(),
    coverageFloor: none(Probability).optional(),
});
/**
 * More trials for the cases of one slice, for example a measure that applies to few cases: every
 * case whose `slices[slice]` is `value` runs `replicates` trials per arm. A case that several
 * entries match runs the largest count.
 */
export const ReplicatesFor = z.strictObject({
    slice: none(Text),
    value: none(Text),
    replicates: none(z.int().min(1)),
    reason: none(Text),
});
/** A reference to the case set a suite evaluates. */
export const CaseSetRef = z.strictObject({
    id: none(CaseSetId),
    path: none(Text),
    digest: none(Digest).optional(),
});
/** A suite: what an application declares it evaluates (REQ-16, REQ-115). It names no system. */
export const Suite = z.strictObject({
    schema: none(z.literal("ichnaea.suite/1")),
    id: none(SuiteId),
    version: none(Text),
    objective: none(Text),
    construct: none(Text),
    decision: none(Text),
    scope: none(Text),
    nonCoverage: none(Text),
    estimand: none(Estimand),
    caseSet: CaseSetRef,
    pools: none(z.array(z.enum(["development", "validation", "sealed", "promoted"])).min(1)).optional(),
    /** Trials per case and arm, unless `replicatesFor` gives a case more. */
    replicates: none(z.int().min(1)),
    replicatesFor: z.array(ReplicatesFor).optional(),
    alpha: none(z.number().gt(0).lt(0.5)).optional(),
    primary: z.array(PrimaryMeasure),
    secondary: none(z.array(MeasureId)).optional(),
    hardGates: none(z.array(GateId)).optional(),
    budget: Budget,
    policy: CiPolicy,
    threats: none(z.array(z.string().min(1))).optional(),
    measureReviewDate: none(CalendarDate),
    paths: none(z.array(z.string().min(1))).optional(),
});
//# sourceMappingURL=suite.js.map