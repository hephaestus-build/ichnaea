import * as z from "zod";

import { content, none } from "../data-class.ts";
import {
  Digest,
  JudgeId,
  MeasuredValue,
  MeasureId,
  RecordDataClass,
  SemVer,
  Text,
  Timestamp,
  TrialId,
  Unit,
} from "../primitives.ts";

/** The definition of a measure (REQ-29). A measure without a card does not register. */
export const MeasureCard = z.strictObject({
  schema: none(z.literal("ichnaea.measureCard/1")),
  id: none(MeasureId),
  version: none(SemVer),
  construct: none(Text),
  operationalDefinition: none(Text),
  valueType: none(z.enum(["binary", "proportion", "score", "level", "preference"])),
  levels: none(z.array(Text).min(2)).optional(),
  unit: none(Text),
  direction: none(z.enum(["higher", "lower"])),
  scale: z.strictObject({ min: none(z.number()), max: none(z.number()) }).optional(),
  justification: none(Text),
  errorModel: none(Text),
  applicability: none(Text),
  tier: none(z.enum(["primary", "secondary", "diagnostic"])),
  /**
   * True for a per-case composite of other measures, for example "every applicable measure good".
   * It mixes constructs, so it is never a primary measure (REQ-34).
   */
  composite: none(z.boolean()).optional(),
  unitOfEvaluation: none(Unit),
  establishes: none(Text),
  computedBy: none(z.enum(["ichnaea", "application", "judge"])),
  judge: none(JudgeId).optional(),
  validation: z
    .strictObject({
      tester: z
        .strictObject({
          status: none(z.enum(["passed", "failed"])),
          digest: none(Digest),
          ranAt: none(Timestamp),
        })
        .optional(),
      calibration: none(Digest).optional(),
    })
    .optional(),
});
/** A measure card. */
export type MeasureCard = z.infer<typeof MeasureCard>;

/**
 * One measure value on one trial (or one turn of it). `applicable: false` is not applicable,
 * never zero or missing, and has no value (REQ-30). An application-computed value names its source
 * (REQ-31).
 */
export const MeasureValue = z.strictObject({
  schema: none(z.literal("ichnaea.measureValue/1")),
  trial: none(TrialId),
  turn: none(z.int().min(0)).optional(),
  measure: none(MeasureId),
  version: none(SemVer),
  applicable: none(z.boolean()),
  value: MeasuredValue.optional(),
  source: none(z.enum(["ichnaea", "application", "judge", "human"])),
  detail: content(z.string()).optional(),
  /**
   * Why the scorer gave this value, in one short sentence, for example "claims a test that is not
   * in the diff". It explains the value to a reader; no statistic reads it.
   */
  why: content(z.string()).optional(),
  dataClass: none(RecordDataClass),
});
/** A measure value. */
export type MeasureValue = z.infer<typeof MeasureValue>;
