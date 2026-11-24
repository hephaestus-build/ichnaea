import * as z from "zod";

import { content, none } from "../data-class.ts";
import {
  Digest,
  JudgeId,
  MeasureId,
  RecordDataClass,
  RunId,
  SemVer,
  Text,
  TrialId,
} from "../primitives.ts";
import { MeasureValue } from "./measure.ts";

const ProtectedRatingsClass = RecordDataClass.exclude(["none"]);
const RaterSlot = z.strictObject({ measure: none(MeasureId), version: none(SemVer) });

/** One rating in an import. Its value inherits the study's data class. */
export const ImportedHumanValue = MeasureValue.extend({
  source: none(z.literal("human")),
  applicable: none(z.literal(true)),
  dataClass: none(ProtectedRatingsClass),
  value: content(z.strictObject({ type: none(z.literal("level")), level: none(Text) })),
});
/** One imported human rating with the measure and trial it belongs to. */
export type ImportedHumanValue = z.infer<typeof ImportedHumanValue>;

/** The registered judge and the stored measure that supplied its ratings. */
export const RatingJudge = z.strictObject({
  id: none(JudgeId),
  digest: none(Digest),
  measure: none(MeasureId),
  version: none(SemVer),
});

/** The run's human-rated measures and the matching ordinal calibration input. */
export const RatingsImport = z.strictObject({
  schema: none(z.literal("ichnaea.ratingsImport/1")),
  run: none(RunId),
  study: none(Text),
  source: none(z.literal("label-studio")),
  registration: none(Digest),
  dataClass: none(ProtectedRatingsClass),
  scale: none(z.array(z.number()).min(2)),
  judge: RatingJudge,
  raters: content(z.array(RaterSlot).length(2)),
  values: content(z.array(ImportedHumanValue).min(2)),
  units: content(
    z
      .array(
        z.strictObject({
          trial: none(TrialId),
          item: content(Text),
          stratum: content(Text),
          configuration: none(z.enum(["base", "candidate", "known-worse"])),
          judge: none(Text),
        }),
      )
      .min(1),
  ),
});
/** A stored rating import. */
export type RatingsImport = z.infer<typeof RatingsImport>;
