import * as z from "zod";

import { content, none, pseudonym } from "../data-class.ts";
import {
  Digest,
  JudgeId,
  Json,
  MeasuredValue,
  MeasureId,
  Probability,
  RecordDataClass,
  SemVer,
  Text,
  Timestamp,
  TrialId,
} from "../primitives.ts";

/** A model-based instrument for a measure, defined as data (REQ-32, REQ-37). */
export const Judge = z.object({
  schema: none(z.literal("ichnaea.judge/1")),
  id: none(JudgeId),
  version: none(SemVer),
  evaluatorKind: none(z.enum(["model", "human", "code"])),
  model: z
    .object({ provider: none(Text), id: none(Text), version: none(Text).optional() })
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
/** A judge record. */
export type Judge = z.infer<typeof Judge>;

/** A label's value: a measured value, or an explicit `unknown` when the rater cannot tell. */
export const LabelValue = z.union([MeasuredValue, z.object({ type: none(z.literal("unknown")) })]);

/** One human or judge annotation on one trial record for one measure (REQ-44). */
export const Label = z.object({
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
/** A label. */
export type Label = z.infer<typeof Label>;

/** An agreement estimate with its interval. */
export const Agreement = z.object({
  statistic: none(z.enum(["raw", "cohen-kappa", "gwet-ac1", "krippendorff-alpha"])),
  estimate: none(z.number()),
  lower: none(z.number()),
  upper: none(z.number()),
  n: none(z.int().min(0)),
});

/** The agreement between a judge and human labels, with the judge's status (REQ-39, REQ-40). */
export const Calibration = z.object({
  schema: none(z.literal("ichnaea.calibration/1")),
  judge: none(JudgeId),
  judgeDigest: none(Digest),
  measure: none(MeasureId),
  calibrationSet: none(Digest),
  humanHuman: z.array(Agreement),
  judgeHuman: z.array(Agreement),
  perRater: z
    .array(
      z.object({
        rater: pseudonym(Text),
        items: none(z.int().min(0)),
        agreement: z.array(Agreement),
      }),
    )
    .optional(),
  confusion: none(z.array(z.array(z.int().min(0)))),
  strata: none(z.array(Text)).optional(),
  tolerance: none(Probability),
  status: none(z.enum(["diagnostic", "calibrated", "expired"])),
  expiry: none(z.array(Text)),
  createdAt: none(Timestamp),
});
/** A calibration record. */
export type Calibration = z.infer<typeof Calibration>;
