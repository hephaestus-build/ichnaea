import * as z from "zod";

import { content, none, pseudonym } from "../data-class.ts";
import {
  Digest,
  JudgeId,
  Json,
  MeasureId,
  Probability,
  RecordDataClass,
  SemVer,
  Timestamp,
  TrialId,
} from "../primitives.ts";

/** A model-based instrument for a measure, defined as data (REQ-32, REQ-37). */
export const Judge = z.object({
  schema: none(z.literal("ichnaea.judge/1")),
  id: none(JudgeId),
  version: none(SemVer),
  evaluatorKind: none(z.enum(["model", "human", "code"])),
  model: z.object({
    provider: none(z.string().min(1)),
    id: none(z.string().min(1)),
    version: none(z.string()).optional(),
  }),
  endpointClass: none(z.string().min(1)),
  promptDigest: none(Digest),
  rubricDigest: none(Digest),
  outputSchema: none(Json),
  outputKind: none(z.enum(["binary", "levels", "pairwise"])),
  parameters: none(z.record(z.string(), Json)),
  swapOrder: none(z.boolean()),
  repeats: none(z.int().min(1)),
});
/** A judge record. */
export type Judge = z.infer<typeof Judge>;

/** One human or judge annotation on one trial record for one measure (REQ-44). */
export const Label = z.object({
  schema: none(z.literal("ichnaea.label/1")),
  trial: none(TrialId),
  measure: none(MeasureId),
  value: none(z.union([z.boolean(), z.number(), z.string(), z.literal("unknown")])),
  responseSet: none(z.array(z.string().min(1))).optional(),
  rater: pseudonym(z.string().min(1)),
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
        rater: pseudonym(z.string().min(1)),
        items: none(z.int().min(0)),
        agreement: z.array(Agreement),
      }),
    )
    .optional(),
  confusion: none(z.array(z.array(z.int().min(0)))),
  strata: none(z.array(z.string().min(1))).optional(),
  tolerance: none(Probability),
  status: none(z.enum(["diagnostic", "calibrated", "expired"])),
  expiry: none(z.array(z.string().min(1))),
  createdAt: none(Timestamp),
});
/** A calibration record. */
export type Calibration = z.infer<typeof Calibration>;
