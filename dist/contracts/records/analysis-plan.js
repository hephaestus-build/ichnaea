import * as z from "zod";
import { none } from "../data-class.js";
import { CaseId, ConfigurationIdentity, Digest, GateId, MeasureId, RunId, SemVer, SuiteId, Text, } from "../primitives.js";
import { CaseSetEntry } from "./case.js";
import { Resolution } from "./resolution.js";
import { CiPolicy, Estimand } from "./suite.js";
/** Which cases a measure can use. The keys and case IDs come from the plan. */
export const Applicability = none(z.record(MeasureId, z.array(CaseId)));
/** One locked primary comparison. A margin is needed only for a non-inferiority claim. */
export const AnalysisPrimary = z.strictObject({
    measure: none(MeasureId),
    margin: none(z.number().gt(0).lt(1)).optional(),
    safetyMargin: none(z.number().min(0)).optional(),
    targetDrop: none(z.number().gt(0).max(1)).optional(),
    coverageFloor: none(z.number().min(0).max(1)).optional(),
});
/** Use the same registered number of fresh binary trials for each selected case. */
export const RegisteredTrialReduction = z.strictObject({
    measure: none(MeasureId),
    k: none(z.int().min(1)),
    cases: none(z.array(CaseId).min(1)),
});
/** Analysis that can be registered before a candidate exists. */
export const AnalysisPlan = z.strictObject({
    schema: none(z.literal("ichnaea.analysisPlan/1")),
    suite: none(SuiteId),
    suiteDigest: none(Digest),
    cases: z.array(CaseSetEntry).min(1),
    caseSet: none(Text),
    caseSetDigest: none(Digest),
    estimand: none(Estimand),
    method: none(z.enum(["binary-randomized-blocks", "estimate-only"])),
    alpha: none(z.number().gt(0).lt(0.5)),
    blocks: none(z.int().min(1)),
    replicates: none(z.int().min(1)),
    primary: z.array(AnalysisPrimary),
    secondary: none(z.array(MeasureId)),
    hardGates: none(z.array(GateId)),
    measures: z.array(z.strictObject({
        id: none(MeasureId),
        version: none(SemVer),
        pin: none(Digest),
    })),
    holm: none(z.array(MeasureId)),
    applicability: Applicability,
    resolution: z.array(Resolution).optional(),
    trialReduction: RegisteredTrialReduction.optional(),
    pilot: z.strictObject({ run: none(RunId), digest: none(Digest) }).optional(),
    base: z.strictObject({
        role: none(z.literal("base")),
        identity: none(ConfigurationIdentity),
    }),
    maxCalls: none(z.int().min(0)),
    policy: CiPolicy,
    ichnaea: none(SemVer),
});
/** The case and measure pins for the plan written beside this lock. */
export const AnalysisLock = z.strictObject({
    schema: none(z.literal("ichnaea.lock/1")),
    plan: none(Digest),
    cases: z.array(CaseSetEntry),
    instruments: none(z.record(MeasureId, Digest)),
});
//# sourceMappingURL=analysis-plan.js.map