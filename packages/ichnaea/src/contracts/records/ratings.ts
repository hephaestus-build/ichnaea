import * as z from "zod";

import { content, none } from "../data-class.ts";
import { Digest, JudgeId, MeasureId, RecordDataClass, RunId, SemVer, Text } from "../primitives.ts";
import { MeasureValue } from "./measure.ts";

const Level = none(z.int().min(1));
// Calibration takes two rater columns. The schema enforces the tuple length as an array.
const RaterPair = none(z.array(Level).length(2)) as unknown as z.ZodType<[number, number]>;

/** One rating in an import. Its value inherits the study's data class. */
export const ImportedHumanValue = MeasureValue.extend({
  source: none(z.literal("human")),
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
  dataClass: none(RecordDataClass),
  scale: none(z.array(z.number()).min(2)),
  judge: RatingJudge,
  values: content(z.array(ImportedHumanValue).min(1)),
  calibration: content(
    z.strictObject({
      scale: none(z.literal("levels")),
      levels: none(z.int().min(2)),
      units: z
        .array(
          z.strictObject({
            item: content(Text),
            stratum: content(Text),
            configuration: none(z.enum(["base", "candidate", "known-worse"])),
            weight: none(z.literal(1)),
            raters: RaterPair,
            judge: Level,
          }),
        )
        .min(1),
    }),
  ),
});
/** A stored rating import. */
export type RatingsImport = z.infer<typeof RatingsImport>;
