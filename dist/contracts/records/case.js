import * as z from "zod";
import { attribute, content, none, personal } from "../data-class.js";
import { CalendarDate, CaseId, CaseSetId, Digest, DigestRef, FindingId, MeasureId, Json, RecordDataClass, Text, Unit, } from "../primitives.js";
/** How a case entered its case set. Decides which estimand it supports. */
export const CaseSelection = z.enum(["curated", "random", "promoted", "generated"]);
/** A pool: a part of a case set with an exposure rule. */
export const Pool = z.enum(["development", "validation", "sealed", "promoted"]);
const provenanceBase = {
    selection: none(CaseSelection.describe("How the case entered its case set. It decides which estimand the case supports.")),
    author: personal(Text.describe("Who wrote the case.")).optional(),
    created: none(CalendarDate.describe("The date the case was created.")),
    collected: none(CalendarDate.describe("The date the input was collected.")).optional(),
    licence: none(Text.describe("The licence of the case content.")),
    exposure: none(z.enum(["public", "private", "sealed"]).describe("Who may see the case.")),
};
const Generator = z.strictObject({
    method: none(Text.describe("How the case was generated.")),
    model: none(Text.describe("The model that generated the case.")).optional(),
    seedSource: none(Text.describe("Where the seed of the generation came from.")).optional(),
});
/**
 * Where a case came from (REQ-08). The source decides what must be recorded: a reused dataset
 * names the dataset and its limits, a generated case names its generator, a collected case its
 * collection date, a promoted case the finding it came from.
 */
export const CaseProvenance = z.discriminatedUnion("source", [
    z.strictObject({ source: none(z.literal("authored")), ...provenanceBase }),
    z.strictObject({ source: none(z.literal("generated")), ...provenanceBase, generator: Generator }),
    z.strictObject({
        source: none(z.literal("reused")),
        ...provenanceBase,
        reusedDataset: z.strictObject({
            name: none(Text.describe("The name of the reused dataset.")),
            version: none(Text.describe("The version of the reused dataset.")).optional(),
            limits: none(Text.describe("The known limits of the dataset for this use.")),
        }),
    }),
    z.strictObject({
        source: none(z.literal("collected")),
        ...provenanceBase,
        collected: none(CalendarDate.describe("The date the input was collected.")),
    }),
    z.strictObject({
        source: none(z.literal("promoted")),
        ...provenanceBase,
        finding: none(FindingId.describe("The finding that the case was promoted from.")),
    }),
]);
/** One scripted turn of a session case. */
export const ScriptedTurn = z.strictObject({
    role: none(z.enum(["user", "assistant", "system", "tool"]).describe("Who speaks the turn.")),
    content: content(Json),
});
/** One evaluation input with its fixtures and hidden references (REQ-08, REQ-09). */
export const Case = z.strictObject({
    schema: none(z.literal("ichnaea.case/1").describe("The record type and its major version.")),
    id: none(CaseId.describe("The case's identifier, unique within its case set.")),
    caseSet: none(CaseSetId.describe("The case set that the case belongs to.")).optional(),
    unit: none(Unit.describe("What one trial of the case is: one turn, a trace, a session of several turns, or an agent episode.")),
    dataClass: none(RecordDataClass.describe("The data class of the case's content. The input, the turns, the references, the slices and the review note take this class.")),
    input: content(z
        .record(z.string(), Json)
        .describe("What the system receives. The keys are the application's own.")),
    turns: z
        .array(ScriptedTurn)
        .describe("The scripted turns of a session case, in order.")
        .optional(),
    fixtures: z
        .array(DigestRef)
        .describe("Files that the case needs, each named with its digest.")
        .optional(),
    references: content(z
        .record(z.string(), Json)
        .describe("Hidden references, such as the facts that a correct answer states. Measures read them, and the system never receives them.")).optional(),
    family: none(Text.describe("The family of variants that the case belongs to. Variants of one input share a family.")).optional(),
    slices: attribute(z
        .record(z.string(), z.string())
        .describe("Labels for descriptive slices of the results, such as a topic. A slice never gets a verdict.")).optional(),
    criticality: none(z
        .enum(["low", "normal", "high", "critical"])
        .describe("How much a failure of the case matters.")).optional(),
    provenance: CaseProvenance.describe("Where the case came from: authored, generated, reused from a dataset, collected, or promoted from a finding."),
    pool: none(Pool.describe("The pool that the case belongs to. Each pool has its own exposure rule.")),
    validation: z
        .strictObject({
        status: none(z
            .enum(["draft", "reviewed", "validated", "suspect"])
            .describe("The review status of the case itself. A suspect case may be broken.")),
        note: content(z.string().describe("A reviewer's note on the case.")).optional(),
    })
        .describe("The review of the case itself.")
        .optional(),
});
/** One entry of a case set manifest. */
export const CaseSetEntry = z.strictObject({
    id: none(CaseId.describe("The case's identifier.")),
    digest: none(Digest.describe("The digest of the case record.")),
    pool: none(Pool.describe("The pool that the case belongs to.")),
    family: none(Text.describe("The family of variants that the case belongs to.")).optional(),
});
/** A versioned collection of cases, identified by the digest of its entries (REQ-10). */
export const CaseSet = z.strictObject({
    schema: none(z.literal("ichnaea.caseSet/1").describe("The record type and its major version.")),
    id: none(CaseSetId.describe("The case set's identifier.")),
    version: none(Text.describe("A version label for people.")).optional(),
    description: none(z.string().describe("What the case set covers.")).optional(),
    digest: none(Digest.describe("The digest of the case entries. It identifies the case set, so a change to any case changes it.")),
    cases: z.array(CaseSetEntry).min(1).describe("One entry for each case."),
    applicability: none(z.record(MeasureId, z.array(CaseId))).optional(),
});
//# sourceMappingURL=case.js.map