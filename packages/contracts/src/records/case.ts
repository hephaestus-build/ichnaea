import * as z from "zod";

import { content, none } from "../data-class.ts";
import {
  CalendarDate,
  CaseId,
  CaseSetId,
  Digest,
  DigestRef,
  Json,
  RecordDataClass,
  Unit,
} from "../primitives.ts";

/** How a case entered its case set. Decides which estimand it supports. */
export const CaseSelection = z.enum(["curated", "random", "promoted", "generated"]);

/** A pool: a part of a case set with an exposure rule. */
export const Pool = z.enum(["development", "validation", "sealed", "promoted"]);
/** A pool. */
export type Pool = z.infer<typeof Pool>;

/** Where a case came from (REQ-08). */
export const CaseProvenance = z.object({
  source: none(z.string().min(1)),
  selection: none(CaseSelection),
  author: none(z.string().min(1)).optional(),
  created: none(CalendarDate),
  collected: none(CalendarDate).optional(),
  licence: none(z.string().min(1)),
  exposure: none(z.enum(["public", "private", "sealed"])),
  reusedDataset: z
    .object({
      name: none(z.string().min(1)),
      version: none(z.string()).optional(),
      limits: none(z.string().min(1)),
    })
    .optional(),
  generator: z
    .object({
      method: none(z.string().min(1)),
      model: none(z.string()).optional(),
      seedSource: none(z.string()).optional(),
    })
    .optional(),
});

/** One scripted user turn of a session case. */
export const ScriptedTurn = z.object({
  role: none(z.enum(["user", "system", "tool"])),
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
  family: none(z.string().min(1)).optional(),
  slices: none(z.record(z.string(), z.string())).optional(),
  criticality: none(z.enum(["low", "normal", "high", "critical"])).optional(),
  provenance: CaseProvenance,
  pool: none(Pool),
  validation: z
    .object({
      status: none(z.enum(["draft", "reviewed", "validated", "suspect"])),
      note: none(z.string()).optional(),
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
  family: none(z.string().min(1)).optional(),
});

/** A versioned collection of cases, identified by the digest of its entries (REQ-10). */
export const CaseSet = z.object({
  schema: none(z.literal("ichnaea.caseSet/1")),
  id: none(CaseSetId),
  version: none(z.string().min(1)).optional(),
  description: none(z.string()).optional(),
  digest: none(Digest),
  cases: z.array(CaseSetEntry).min(1),
});
/** A case set. */
export type CaseSet = z.infer<typeof CaseSet>;
