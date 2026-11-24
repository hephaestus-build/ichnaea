import { digest } from "../contracts/canonical.js";
import { caseDigest, caseSetDigest, configurationIdentity } from "../contracts/identity.js";
import { AnalysisLock, AnalysisPlan, } from "../contracts/records/analysis-plan.js";
import { PlanError } from "./resolve.js";
/** The smallest decision horizon with one extra block. */
export function defaultBlocks(primaryComparisons, alpha) {
    return primaryComparisons === 0 ? 1 : Math.ceil(Math.log2(primaryComparisons / alpha)) + 1;
}
export const DEFAULT_TRIAL_DEADLINE_MS = 60_000;
export function checkCases(caseSet, cases, purpose) {
    const byId = new Map(cases.map((entry) => [entry.id, entry]));
    if (byId.size !== cases.length ||
        new Set(caseSet.cases.map((entry) => entry.id)).size !== cases.length ||
        caseSet.cases.length !== cases.length)
        throw new PlanError("each case must appear once in the case set and its source");
    if (caseSetDigest(caseSet.cases) !== caseSet.digest)
        throw new PlanError("the case set digest does not match its entries");
    for (const entry of caseSet.cases) {
        const record = byId.get(entry.id);
        if (!record ||
            caseDigest(record) !== entry.digest ||
            record.pool !== entry.pool ||
            record.family !== entry.family)
            throw new PlanError(`case '${entry.id}' does not match the case set`);
        if (entry.pool === "sealed" && purpose !== "confirmation")
            throw new PlanError("a sealed pool needs a confirmation plan");
    }
}
const DEFAULT_POLICY = {
    onRegression: "block",
    onInconclusive: "report",
    onEstimateOnly: "report",
};
/** Planned calls for the block horizon, before any retries. */
export function blockCalls(cases, comparisons, blocks, replicates, callsPerTrial = 1, arms = comparisons > 0 ? 2 : 1) {
    return cases * arms * blocks * replicates * callsPerTrial;
}
export function resolveAnalysis(input) {
    const holm = input.primary.map((entry) => entry.measure);
    if (new Set(holm).size !== holm.length)
        throw new PlanError("each primary comparison must have a unique measure ID");
    const caseIds = new Set(input.caseSet.cases.map((entry) => entry.id));
    for (const primary of input.primary) {
        const mask = input.applicability[primary.measure];
        if (!mask || mask.some((id) => !caseIds.has(id)) || new Set(mask).size !== mask.length)
            throw new PlanError(`invalid applicability mask for '${primary.measure}'`);
        if (primary.safetyMargin !== undefined &&
            (primary.margin === undefined || primary.safetyMargin > primary.margin))
            throw new PlanError(`invalid safety margin for '${primary.measure}'`);
    }
    const mustNever = new Set();
    for (const declaration of input.mustNever ?? []) {
        const { measure, cases, detector } = declaration;
        const selected = new Set(cases);
        if (mustNever.has(measure) || holm.some((id) => id === measure))
            throw new PlanError(`must-never measure '${measure}' must be declared once and cannot be primary`);
        mustNever.add(measure);
        if (selected.size !== cases.length || cases.some((id) => !caseIds.has(id)))
            throw new PlanError(`must-never measure '${measure}' needs unique selected cases`);
        if (detector.kind === "deterministic") {
            const variants = new Set(detector.variants.map((variant) => variant.pattern));
            const controls = new Set(detector.variants.map((variant) => variant.positiveControl));
            if (controls.size !== detector.variants.length ||
                variants.size !== detector.variants.length ||
                detector.variants.some(({ positiveControl }) => !caseIds.has(positiveControl) || selected.has(positiveControl)))
                throw new PlanError(`must-never measure '${measure}' needs a separate planned positive control for each pattern`);
        }
    }
    const alpha = input.alpha ?? 0.05;
    const blocks = input.blocks ?? defaultBlocks(holm.length, alpha);
    const replicates = input.replicates ?? 1;
    const reduction = input.trialReduction;
    if (reduction) {
        if (holm.length > 0)
            throw new PlanError("a trial reduction requires one arm and no primary comparison");
        if (new Set(reduction.cases).size !== reduction.cases.length)
            throw new PlanError("a trial reduction lists a case more than once");
        const unknown = reduction.cases.find((id) => !caseIds.has(id));
        if (unknown !== undefined)
            throw new PlanError(`trial reduction case '${unknown}' is not selected`);
        if (reduction.k > blocks * replicates)
            throw new PlanError("trial reduction k exceeds the planned trials per case");
    }
    const estimand = input.estimand ?? "fixed-cases";
    const method = holm.length > 0 && estimand === "fixed-cases" ? "binary-randomized-blocks" : "estimate-only";
    return AnalysisPlan.parse({
        schema: "ichnaea.analysisPlan/1",
        suite: input.suite,
        suiteDigest: input.suiteDigest,
        cases: input.caseSet.cases,
        caseSet: input.caseSet.id,
        caseSetDigest: input.caseSet.digest,
        estimand,
        method,
        alpha,
        blocks,
        replicates,
        primary: input.primary,
        secondary: input.secondary,
        hardGates: input.hardGates,
        measures: input.measures,
        holm,
        applicability: input.applicability,
        ...(reduction === undefined ? {} : { trialReduction: reduction }),
        ...(input.mustNever === undefined ? {} : { mustNever: input.mustNever }),
        base: { role: "base", identity: configurationIdentity(input.base) },
        maxCalls: input.maxCalls ??
            blockCalls(input.caseSet.cases.length, holm.length, blocks, replicates, input.callsPerTrial),
        ...(input.callsPerTrial === undefined ? {} : { callsPerTrial: input.callsPerTrial }),
        ...(input.deadlineMs === undefined ? {} : { deadlineMs: input.deadlineMs }),
        ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
        policy: input.policy ?? DEFAULT_POLICY,
        ichnaea: input.ichnaea,
    });
}
export function lockFor(plan) {
    return AnalysisLock.parse({
        schema: "ichnaea.lock/1",
        plan: digest(plan),
        cases: plan.cases,
        instruments: Object.fromEntries(plan.measures.map(({ id, pin }) => [id, pin])),
    });
}
//# sourceMappingURL=analysis.js.map