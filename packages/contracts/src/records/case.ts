import * as z from "zod";

import { content, none, personal } from "../data-class.ts";
import {
  CalendarDate,
  CaseId,
  CaseSetId,
  Digest,
  DigestRef,
  FindingId,
  Json,
  RecordDataClass,
  Text,
  Unit,
} from "../primitives.ts";

/** How a case entered its case set. Decides which estimand it supports. */
export const CaseSelection = z.enum(["curated", "random", "promoted", "generated"]);

/** A pool: a part of a case set with an exposure rule. */
export const Pool = z.enum(["development", "validation", "sealed", "promoted"]);
/** A pool. */
export type Pool = z.infer<typeof Pool>;

const provenanceBase = {
  selection: none(CaseSelection),
  author: personal(Text).optional(),
  created: none(CalendarDate),
  collected: none(CalendarDate).optional(),
  licence: none(Text),
  exposure: none(z.enum(["public", "private", "sealed"])),
};

const Generator = z.object({
  method: none(Text),
  model: none(Text).optional(),
  seedSource: none(Text).optional(),
});

/**
 * Where a case came from (REQ-08). The source decides what must be recorded: a reused dataset
 * names the dataset and its limits, a generated case names its generator, a collected case its
 * collection date, a promoted case the finding it came from.
 */
export const CaseProvenance = z.discriminatedUnion("source", [
  z.object({ source: none(z.literal("authored")), ...provenanceBase }),
  z.object({ source: none(z.literal("generated")), ...provenanceBase, generator: Generator }),
  z.object({
    source: none(z.literal("reused")),
    ...provenanceBase,
    reusedDataset: z.object({
      name: none(Text),
      version: none(Text).optional(),
      limits: none(Text),
    }),
  }),
  z.object({
    source: none(z.literal("collected")),
    ...provenanceBase,
    collected: none(CalendarDate),
  }),
  z.object({ source: none(z.literal("promoted")), ...provenanceBase, finding: none(FindingId) }),
]);

/** One scripted turn of a session case. */
export const ScriptedTurn = z.object({
  role: none(z.enum(["user", "assistant", "system", "tool"])),
  content: content(Json),
});

/** One evaluation input with its fixtures and hidden references (REQ-08, REQ-09). */
export const Case = z.object({
  schema: none(z.literal("ichnaea.case/1")),
  id: none(CaseId),
  caseSet: none(CaseSetId).optional(),
  unit: none(Unit),
  dataClass: none(RecordDataClass),
  input: content(z.record(z.string(), Json)),
  turns: z.array(ScriptedTurn).optional(),
  fixtures: z.array(DigestRef).optional(),
  references: content(z.record(z.string(), Json)).optional(),
  family: none(Text).optional(),
  slices: none(z.record(z.string(), z.string())).optional(),
  criticality: none(z.enum(["low", "normal", "high", "critical"])).optional(),
  provenance: CaseProvenance,
  pool: none(Pool),
  validation: z
    .object({
      status: none(z.enum(["draft", "reviewed", "validated", "suspect"])),
      note: content(z.string()).optional(),
    })
    .optional(),
});
/** A case. */
export type Case = z.infer<typeof Case>;

/** One entry of a case set manifest. */
export const CaseSetEntry = z.object({
  id: none(CaseId),
  digest: none(Digest),
  pool: none(Pool),
  family: none(Text).optional(),
});

/** A versioned collection of cases, identified by the digest of its entries (REQ-10). */
export const CaseSet = z.object({
  schema: none(z.literal("ichnaea.caseSet/1")),
  id: none(CaseSetId),
  version: none(Text).optional(),
  description: none(z.string()).optional(),
  digest: none(Digest),
  cases: z.array(CaseSetEntry).min(1),
});
/** A case set. */
export type CaseSet = z.infer<typeof CaseSet>;
