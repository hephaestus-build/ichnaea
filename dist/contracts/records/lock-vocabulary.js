import * as z from "zod";
import { none } from "../data-class.js";
import { Json, Text } from "../primitives.js";
import { ConfigName } from "./setup.js";
/** A module reference: a relative path with no `.` or `..` segment to a JavaScript or TypeScript file. */
export const ModulePath = z
    .string()
    .regex(/^(?:[A-Za-z0-9_@+-][A-Za-z0-9._@+-]*\/)*[A-Za-z0-9_@+-][A-Za-z0-9._@+-]*\.(?:ts|mts|js|mjs)$/);
/**
 * What computes a measure: a built-in scorer, or an instrument of the suite. A TypeScript measure
 * is a module reference inside its instrument's files, never a function value. Each form has a
 * member that the others lack, so a reader that ignores unknown members still tells them apart.
 */
export const ScorerRef = z.xor([
    z.strictObject({
        builtin: none(ConfigName.describe("The built-in scorer, such as ndcg or links-grounded.")),
        options: none(z.record(ConfigName, Json).describe("The built-in scorer's options, such as k for ndcg.")).optional(),
    }),
    z.strictObject({
        instrument: none(ConfigName.describe("The instrument that exports the function.")),
        module: none(ModulePath.describe("The module, relative to the instrument's files.")),
        export: none(Text.describe("The exported function's name.")),
    }),
    z.strictObject({
        instrument: none(ConfigName.describe("The instrument that scores the measure.")),
        dimension: none(Text.describe("The dimension of the instrument's report that the measure reads.")),
    }),
]);
/** The cases a measure applies to, fixed before the run: those whose slice is set. */
export const AppliesTo = z.strictObject({
    slice: none(Text.describe("The slice that a case must have.")),
});
/** A reduction over the trials of a case: pass^k (`all`) or pass@k (`any`). Estimate-only. */
export const TrialReduction = z.xor([
    z.strictObject({ all: z.strictObject({ k: none(z.int().min(1).describe("k.")) }) }),
    z.strictObject({ any: z.strictObject({ k: none(z.int().min(1).describe("k.")) }) }),
]);
const measureShape = {
    stage: none(ConfigName.describe("The stage whose status or output the measure reads.")).optional(),
    status: none(z
        .enum(["ok", "not_invoked", "failed", "skipped", "replayed"])
        .describe("For a stage status measure, the status that counts as true.")).optional(),
    iteration: none(z
        .enum(["last", "first", "any", "all"])
        .describe("The iteration of the stage that the measure reads. Default last.")).optional(),
    scorer: ScorerRef.describe("What computes the measure.").optional(),
    appliesTo: AppliesTo.optional(),
    direction: none(z.enum(["higher", "lower"]).describe("Which way is better.")).optional(),
    reduce: TrialReduction.optional(),
    estimand: none(z
        .enum(["these-cases", "population"])
        .describe("What an estimate is about. Default these-cases.")).optional(),
    weighting: none(z
        .enum(["per-case", "per-family"])
        .describe("How cases weigh in an estimate. Default per-case.")).optional(),
    gate: none(z.boolean().describe("A hard gate. It needs deterministic: true on the same measure.")).optional(),
    deterministic: none(z.boolean().describe("Every trial of a case in an arm gives the same value.")).optional(),
};
/**
 * How a level measure is tested. With `"equal"`, the levels are equally spaced and the measure is
 * tested as a score on (level − min)/(max − min). Its limits, fidelity margins and the ±0.15
 * arm-bias bound therefore live on [0, 1], and a limit means the same for levels 1–5 as for 0–3.
 * With `{ cut }`, it is tested as binary, with success at or above the cut level registered before
 * the run. With neither, it has no test.
 */
export const LevelSpacing = z.xor([
    none(z
        .literal("equal")
        .describe("The levels are equally spaced. The measure is tested as a score on (level − min)/(max − min), so its limits and margins live on [0, 1].")),
    z.strictObject({
        cut: none(z
            .number()
            .describe("The lowest level that counts as success: one of the levels, above the lowest. lock checks it.")),
    }),
]);
/**
 * A measure, by the type of its values. A quantity has a unit and is descriptive only. A level is a
 * number, one of the measure's `levels`, and a scorer reports a level by that value. What a level
 * measure's limits mean depends on its `spacing` (LevelSpacing).
 */
export const MeasureDefinition = z.discriminatedUnion("type", [
    z.strictObject({ type: none(z.literal("binary")), ...measureShape }),
    z.strictObject({ type: none(z.literal("score")), ...measureShape }),
    z.strictObject({
        type: none(z.literal("level")),
        levels: none(z
            .array(z.number())
            .min(2)
            .describe("The levels, strictly ascending. A scorer reports a level by its value. lock checks the order.")),
        anchors: none(z
            .record(Text, Text)
            .describe("For a level, written as JSON writes the number (2, 0.5), the text that anchors it. lock checks that each key is a level.")).optional(),
        spacing: LevelSpacing.optional(),
        ...measureShape,
    }),
    z.strictObject({
        type: none(z.literal("quantity")),
        unit: none(Text.describe("The unit, such as ms.")),
        ...measureShape,
    }),
]);
/** A primary measure's registration: the largest drop accepted, who set it, and why. */
export const PrimaryRegistration = z.strictObject({
    limit: none(z
        .number()
        .gt(0)
        .lt(1)
        .describe("The largest drop that the owner accepts, inside (0, 1). It applies to Pass. A limit of 0 could never pass, and a limit of 1 would accept any drop.")),
    owner: none(Text.describe("The role that owns the limit.")),
    reason: none(Text.describe("Why the limit has this value.")),
});
//# sourceMappingURL=lock-vocabulary.js.map