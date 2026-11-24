import * as z from "zod";
import { content, none } from "../data-class.js";
import { ArmName, CaseId, ConfigurationIdentity, Digest, GateId, MeasureId, PlanDigest, Real, RecordDataClass, RunId, Seed, SemVer, Text, Timestamp, } from "../primitives.js";
import { PowerEntry } from "./plan.js";
import { MustNeverCount } from "./must-never.js";
import { Resolution } from "./resolution.js";
import { Estimand } from "./suite.js";
/** A run verdict (REQ-53). */
export const Verdict = z.enum(["PASS", "REGRESSION", "INCONCLUSIVE", "INVALID"]);
/** A verdict for one primary measure. */
export const MeasureVerdict = z.enum([
    "NON-INFERIOR",
    "REGRESSION",
    "INCONCLUSIVE",
    "ESTIMATE-ONLY",
]);
/** Counts behind a rate, with not-applicable and missing kept apart (REQ-30). */
export const Availability = z.strictObject({
    planned: none(z.int().min(0)),
    available: none(z.int().min(0)),
    notApplicable: none(z.int().min(0)),
    missing: none(z.int().min(0)),
});
/** An estimate with its interval and method. */
export const Estimate = z.strictObject({
    estimate: none(Real),
    lower: none(Real),
    upper: none(Real),
    level: none(z.number().gt(0).lt(1)),
    sided: none(z.enum(["two", "lower", "upper"])),
    method: none(Text),
});
/** A case whose binary outcome changed between two arms (REQ-52). Rates are per-case pass rates. */
export const Flip = z.strictObject({
    case: none(CaseId),
    direction: none(z.enum(["negative", "positive"])),
    base: none(z.number().min(0).max(1)),
    candidate: none(z.number().min(0).max(1)),
});
/**
 * Whether one result of a comparison lies inside the validated domain of its method, and why not
 * (decision 0015). A result that is not validated names at least one reason.
 */
export const Validity = z.discriminatedUnion("validated", [
    z.strictObject({ validated: none(z.literal(true)), limitations: none(z.array(Text).max(0)) }),
    z.strictObject({ validated: none(z.literal(false)), limitations: none(z.array(Text).min(1)) }),
]);
/** One arm's estimate for a measure. */
export const ArmEstimate = z.strictObject({
    arm: none(ArmName),
    rate: Estimate,
    availability: Availability,
    caseAvailability: z
        .strictObject({
        planned: none(z.int().min(0)),
        observed: none(z.int().min(0)),
    })
        .optional(),
    intervalValidity: Validity.optional(),
});
/** The comparison of one candidate with the base for one measure. None in estimate-only mode. */
export const Comparison = z.strictObject({
    base: none(ArmName),
    candidate: none(ArmName),
    difference: Estimate,
    margin: none(z.number().min(0)),
    safetyMargin: none(z.number().min(0)),
    nonInferiorityP: none(Real),
    regressionP: none(Real),
    regressionPAdjusted: none(Real),
    /** The stable name of the regression test's method. */
    regressionMethod: none(Text),
    /**
     * Whether the regression test lies inside the domain where its type-I error is shown. REGRESSION
     * needs it. It does not depend on the margin, and it never vouches for the interval.
     */
    regression: Validity,
    /**
     * Whether the non-inferiority result, the interval against the margin, lies inside the domain
     * where its coverage is shown. NON-INFERIOR, and so PASS, needs it and `regression` (decision
     * 0015).
     */
    nonInferiority: Validity,
    flips: z.array(Flip),
});
/**
 * One imputation of the sensitivity analysis for missing trials (REQ-56): the measure decided
 * again with its missing trials imputed against one verdict. Against non-inferiority, missing
 * candidate trials fail and missing base trials pass; against regression, the reverse.
 */
export const SensitivityResult = z.strictObject({
    imputation: none(z.enum(["against-non-inferiority", "against-regression"])),
    difference: Estimate,
    nonInferiorityP: none(Real),
    regressionPAdjusted: none(Real),
    regression: Validity,
    nonInferiority: Validity,
    verdict: none(MeasureVerdict),
    /** Whether this imputation changes the measure's verdict, which then becomes INCONCLUSIVE. */
    changesVerdict: none(z.boolean()),
});
const Count = none(z.int().min(0));
const Variance = none(z.number().min(0).nullable());
const BlockDenominators = z.strictObject({
    planned: Count,
    observed: Count,
    effective: none(Count.nullable()),
    reason: none(Text).optional(),
});
const Noise = z.strictObject({
    arms: z.array(z.strictObject({
        arm: none(ArmName),
        withinCaseVariance: Variance,
        replicatedCells: Count,
        caseDispersion: Variance,
    })),
    betweenBlockVariance: Variance,
    contrastBlocks: Count,
});
/** The result for one primary or secondary measure. */
export const MeasureOutcome = z.strictObject({
    measure: none(MeasureId),
    version: none(SemVer),
    tier: none(z.enum(["primary", "secondary"])),
    estimand: none(Estimand),
    arms: z.array(ArmEstimate).min(1),
    comparisons: z.array(Comparison),
    verdict: none(MeasureVerdict),
    coverage: none(z.number().min(0).max(1)),
    blocks: BlockDenominators.optional(),
    noise: Noise.optional(),
    /** Both imputations of a primary measure when the analysis ran; empty otherwise. */
    sensitivity: z.array(SensitivityResult),
    notes: none(z.array(Text)),
});
/** The result of one hard gate. */
export const GateResult = z.strictObject({
    gate: none(GateId),
    passed: none(z.boolean()),
    failures: none(z.int().min(0)),
    detail: content(z.string(), "special").optional(),
});
/** The comparison of missing trials between arms (REQ-56). */
export const Missingness = z.strictObject({
    byArm: z.array(z.strictObject({
        arm: none(ArmName),
        missing: none(z.int().min(0)),
        planned: none(z.int().min(0)),
    })),
    differs: none(z.boolean()),
    /**
     * `not-needed` when no primary measure has a missing trial in either arm; otherwise whether the
     * sensitivity analysis changes a verdict.
     */
    sensitivity: none(z.enum(["unchanged", "changes-verdict", "not-needed"])),
});
const ReductionMissing = z.strictObject({ status: none(z.literal("missing")) });
const ReductionEstimate = z.strictObject({
    status: none(z.enum(["observed", "estimate-only"])),
    passAll: none(z.number().min(0).max(1)),
    passAny: none(z.number().min(0).max(1)),
});
const ReductionCounts = {
    case: none(CaseId),
    plannedTrials: none(z.int().min(0)),
    validTrials: none(z.int().min(0)),
};
/** Descriptive pass^k and pass@k estimates from the registered cases. */
const TrialReduction = z.strictObject({
    measure: none(MeasureId),
    k: none(z.int().min(1)),
    cases: z.array(z.discriminatedUnion("status", [
        ReductionMissing.extend(ReductionCounts),
        ReductionEstimate.extend(ReductionCounts),
    ])),
    overall: z.discriminatedUnion("status", [ReductionMissing, ReductionEstimate]),
});
/** The verdict of one run with estimates, intervals, flips and lineage (REQ-49 to REQ-56). */
export const Decision = z.strictObject({
    schema: none(z.literal("ichnaea.decision/1")),
    mode: none(z.enum(["decision", "estimate-only"])),
    verdict: none(Verdict.nullable()),
    reason: none(Text),
    /** Identifies a drop supported by the within-run test. */
    reasonCode: none(z.literal("DROP_IN_THESE_RUNS_ONLY")).optional(),
    /** A failed hard gate caused the regression verdict. */
    cause: none(z.literal("gate")).optional(),
    /**
     * What the verdict is about, stated next to it in every output and built from the records: the
     * cases the primary measures compare. A failed hard gate says that a
     * deterministic check failed; an INVALID decision makes no claim.
     */
    scope: none(Text),
    plan: none(PlanDigest),
    run: none(RunId),
    runDigest: none(Digest),
    arms: z
        .array(z.strictObject({
        name: none(ArmName),
        role: none(z.enum(["base", "candidate", "reference"])),
        identity: none(ConfigurationIdentity),
    }))
        .min(1),
    differingFactors: none(z.array(Text)),
    alpha: none(z.number().gt(0).lt(0.5)),
    measures: z.array(MeasureOutcome),
    gates: z.array(GateResult),
    /**
     * The power statement (REQ-54): the plan's statement unchanged, and one run-time entry per
     * primary measure. An INVALID decision computes no run-time entry: each one says "run invalid",
     * so no later plan can take its noise as an assumption.
     */
    power: z.strictObject({ planning: z.array(PowerEntry), run: z.array(PowerEntry) }),
    resolution: z.array(Resolution).optional(),
    trialReduction: TrialReduction.optional(),
    mustNever: z.array(MustNeverCount).optional(),
    missingness: Missingness,
    invalidReasons: none(z.array(Text)),
    limitations: none(z.array(Text)),
    seed: Seed,
    decidedAt: none(Timestamp),
    ichnaea: none(SemVer),
    dataClass: none(RecordDataClass),
});
//# sourceMappingURL=decision.js.map