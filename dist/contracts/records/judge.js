import * as z from "zod";
import { content, none, pseudonym } from "../data-class.js";
import { Digest, JudgeId, Json, MeasuredValue, MeasureId, Probability, RecordDataClass, SemVer, Text, Timestamp, TrialId, } from "../primitives.js";
/** A model-based instrument for a measure, defined as data (REQ-32, REQ-37). */
export const Judge = z.strictObject({
    schema: none(z.literal("ichnaea.judge/1")),
    id: none(JudgeId),
    version: none(SemVer),
    evaluatorKind: none(z.enum(["model", "human", "code"])),
    // Optional because a human or code evaluator has no model. A model evaluator without a model
    // identity still validates here; REQ-37 ties the two together.
    model: z
        .strictObject({ provider: none(Text), id: none(Text), version: none(Text).optional() })
        .optional(),
    endpointClass: none(Text),
    promptDigest: none(Digest),
    rubricDigest: none(Digest),
    outputSchema: none(Json),
    outputKind: none(z.enum(["binary", "score", "level", "preference"])),
    parameters: none(z.record(z.string(), Json)),
    swapOrder: none(z.boolean()),
    repeats: none(z.int().min(1)),
});
/** A label's value: a measured value, or an explicit `unknown` when the rater cannot tell. */
export const LabelValue = MeasuredValue;
/** One human or judge annotation on one trial record for one measure (REQ-44). */
export const Label = z.strictObject({
    schema: none(z.literal("ichnaea.label/1")),
    trial: none(TrialId),
    turn: none(z.int().min(0)).optional(),
    measure: none(MeasureId),
    value: LabelValue,
    responseSet: none(z.array(Text)).optional(),
    rater: pseudonym(Text),
    raterRole: none(z.enum(["expert", "crowd", "developer", "user", "judge"])),
    source: none(z.enum(["bundle", "application", "tool", "judge"])),
    rubricDigest: none(Digest),
    bundleDigest: none(Digest).optional(),
    labelledAt: none(Timestamp),
    rationale: content(z.string()).optional(),
    dataClass: none(RecordDataClass),
});
/** An agreement estimate with its interval. */
export const Agreement = z.strictObject({
    statistic: none(z.enum(["raw", "cohen-kappa", "gwet-ac1", "krippendorff-alpha"])),
    estimate: none(z.number()),
    lower: none(z.number()),
    upper: none(z.number()),
    n: none(z.int().min(0)),
});
/** The agreement between a judge and human labels, with the judge's status (REQ-39, REQ-40). */
export const Calibration = z.strictObject({
    schema: none(z.literal("ichnaea.calibration/1")),
    judge: none(JudgeId),
    judgeDigest: none(Digest),
    measure: none(MeasureId),
    calibrationSet: none(Digest),
    humanHuman: z.array(Agreement),
    judgeHuman: z.array(Agreement),
    // Per-rater agreement is a score about a person: the whole list is pseudonymous and never leaves
    // the calibration record (REQ-40, REQ-130).
    perRater: pseudonym(z.array(z.strictObject({ rater: Text, items: z.int().min(0), agreement: z.array(Agreement) }))).optional(),
    confusion: none(z.array(z.array(z.int().min(0)))),
    strata: none(z.array(Text)).optional(),
    tolerance: none(Probability),
    status: none(z.enum(["diagnostic", "calibrated", "expired"])),
    expiry: none(z.array(Text)),
    createdAt: none(Timestamp),
});
//# sourceMappingURL=judge.js.map