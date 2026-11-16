import * as z from "zod";
import { content, none } from "../data-class.js";
import { Digest, JudgeId, MeasuredValue, MeasureId, RecordDataClass, SemVer, Text, Timestamp, TrialId, Unit, } from "../primitives.js";
/** The definition of a measure (REQ-29). A measure without a card does not register. */
export const MeasureCard = z.strictObject({
    schema: none(z.literal("ichnaea.measureCard/1").describe("The record type and its major version.")),
    id: none(MeasureId.describe("The measure's identifier.")),
    version: none(SemVer.describe("The version of the measure's definition.")),
    construct: none(Text.describe("What the measure is meant to capture.")),
    operationalDefinition: none(Text.describe("How a value is computed from an answer.")),
    valueType: none(z
        .enum(["binary", "proportion", "score", "level", "preference"])
        .describe("The kind of value that the measure gives.")),
    levels: none(z.array(Text).min(2).describe("The ordered levels of a level measure.")).optional(),
    unit: none(Text.describe("The unit of a value.")),
    direction: none(z.enum(["higher", "lower"]).describe("Whether a higher or a lower value is better.")),
    scale: z
        .strictObject({
        min: none(z.number().describe("The lowest possible value.")),
        max: none(z.number().describe("The highest possible value.")),
    })
        .describe("The range of a score.")
        .optional(),
    justification: none(Text.describe("Why the measure fits the decision that the suite supports.")),
    errorModel: none(Text.describe("How the measure can be wrong.")),
    applicability: none(Text.describe("Which cases the measure applies to.")),
    tier: none(z
        .enum(["primary", "secondary", "diagnostic"])
        .describe("Primary measures decide the verdict. Secondary and diagnostic measures are reported.")),
    /**
     * True for a per-case composite of other measures, for example "every applicable measure good".
     * It mixes constructs, so it is never a primary measure (REQ-34).
     */
    composite: none(z
        .boolean()
        .describe("True for a per-case composite of other measures. A composite is never a primary measure.")).optional(),
    unitOfEvaluation: none(Unit.describe("What one value is computed over: a turn, a trace, a session or an episode.")),
    establishes: none(Text.describe("What a value of the measure establishes.")),
    computedBy: none(z
        .enum(["ichnaea", "application", "judge"])
        .describe("Who computes the value: Ichnaea, the application or a judge.")),
    judge: none(JudgeId.describe("The judge that computes the value, when a judge does.")).optional(),
    validation: z
        .strictObject({
        tester: z
            .strictObject({
            status: none(z
                .enum(["passed", "failed"])
                .describe("Whether the measure passed its known-good and known-bad check.")),
            digest: none(Digest.describe("The digest of the check that ran.")),
            ranAt: none(Timestamp.describe("When the check ran.")),
        })
            .describe("The latest known-good and known-bad check of the measure.")
            .optional(),
        calibration: none(Digest.describe("The digest of the judge's calibration record.")).optional(),
    })
        .describe("The evidence that the measure works.")
        .optional(),
});
/**
 * One measure value on one trial (or one turn of it). `applicable: false` is not applicable,
 * never zero or missing, and has no value (REQ-30). An application-computed value names its source
 * (REQ-31).
 */
export const MeasureValue = z.strictObject({
    schema: none(z.literal("ichnaea.measureValue/1").describe("The record type and its major version.")),
    trial: none(TrialId.describe("The trial that the value belongs to.")),
    turn: none(z.int().min(0).describe("The turn of the trial, for a measure that scores each turn.")).optional(),
    measure: none(MeasureId.describe("The measure.")),
    version: none(SemVer.describe("The version of the measure that computed the value.")),
    applicable: none(z
        .boolean()
        .describe("False when the measure does not apply. Such a value is neither zero nor missing.")),
    value: MeasuredValue.describe("The value, with its kind.").optional(),
    source: none(z
        .enum(["ichnaea", "application", "judge", "human"])
        .describe("Who computed the value: Ichnaea, the application, a judge or a person.")),
    detail: content(z.string().describe("A note on the value.")).optional(),
    dataClass: none(RecordDataClass.describe("The data class of the note.")),
});
//# sourceMappingURL=measure.js.map