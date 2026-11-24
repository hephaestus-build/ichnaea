import { readFile } from "node:fs/promises";
import * as z from "zod";

import { classRank } from "../contracts/data-class.ts";
import { digest } from "../contracts/canonical.ts";
import { MeasureId, RecordDataClass, SemVer, Text, TrialId } from "../contracts/primitives.ts";
import type { MeasureValue } from "../contracts/records/measure.ts";
import { ImportedHumanValue, RatingJudge, RatingsImport } from "../contracts/records/ratings.ts";

import { verifyRatingJudge } from "./ratings-calibration.ts";
import { FileStore } from "./store.ts";

const User = z.int().min(1);
const Rater = z.strictObject({ user: User, measure: MeasureId, version: SemVer });
const Registration = z.strictObject({
  study: Text,
  control: Text,
  dataClass: RecordDataClass,
  scale: z.array(z.number()).min(2),
  raters: z.tuple([Rater, Rater]),
  judge: RatingJudge,
});
const Key = z.record(
  Text,
  z.strictObject({
    trial: TrialId,
    stratum: Text,
    configuration: z.enum(["base", "candidate", "known-worse"]),
  }),
);
const Export = z.array(
  z.object({
    data: z.object({ item_id: Text }),
    annotations: z.array(
      z.object({
        completed_by: z.union([User, z.object({ id: User })]).optional(),
        was_cancelled: z.boolean().optional(),
        result: z.array(
          z.object({
            from_name: Text,
            type: Text,
            value: z.unknown(),
          }),
        ),
      }),
    ),
  }),
);
const NumberResult = z.object({ number: z.number() });

type LabelStudioTask = z.infer<typeof Export>[number];
type Study = z.infer<typeof Registration>;

function readAnnotations(
  task: LabelStudioTask,
  study: Study,
  levels: ReadonlySet<number>,
): Map<number, number> {
  const labels = new Map<number, number>();
  for (const annotation of task.annotations) {
    if (annotation.was_cancelled) continue;
    const user =
      typeof annotation.completed_by === "object"
        ? annotation.completed_by.id
        : annotation.completed_by;
    if (!user || !study.raters.some((rater) => rater.user === user))
      throw new Error("an annotation is from an unregistered rater");
    if (labels.has(user)) throw new Error("the export repeats a rater’s annotation");
    const results = annotation.result.filter((result) => result.from_name === study.control);
    const rating = results[0];
    const number = NumberResult.safeParse(rating?.value);
    if (results.length !== 1 || rating?.type !== "number" || !number.success)
      throw new Error(
        "each rater must give one numeric annotation for the registered rating control",
      );
    if (!levels.has(number.data.number))
      throw new Error("a human rating is outside the registered scale");
    labels.set(user, number.data.number);
  }
  return labels;
}

/** Files and destination for an offline Label Studio ratings import. */
export interface ImportRatingsInput {
  /** The Ichnaea record store. */
  readonly store: string;
  /** The existing run to which the ratings belong. */
  readonly run: string;
  /** The full JSON export of completed Label Studio tasks. */
  readonly file: string;
  /** The local JSON mapping from opaque task IDs to trials and calibration metadata. */
  readonly key: string;
  /** The JSON study registration with the ordered rating scale and two rater slots. */
  readonly registration: string;
}

async function read<T>(file: string, schema: z.ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error(`cannot read JSON from '${file}'`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new Error(`invalid record in '${file}'`);
  return parsed.data;
}

/** Imports two raters' numeric annotations, keeping each value and writing a local calibration input. */
export async function importLabelStudio(input: ImportRatingsInput): Promise<RatingsImport> {
  const store = new FileStore(input.store);
  const [run, registration, key, tasks] = await Promise.all([
    store.read(input.run),
    read(input.registration, Registration),
    read(input.key, Key),
    read(input.file, Export),
  ]);
  const { raters, scale, dataClass, study, judge } = registration;
  if (dataClass === "none") throw new Error("human ratings need a protected data class");
  const levels = new Set(scale);
  if (levels.size !== scale.length) throw new Error("the registered scale repeats a rating");
  if (raters[0].user === raters[1].user || raters[0].measure === raters[1].measure)
    throw new Error("the two registered raters need distinct users and measure IDs");
  if (
    !run.plan.measures.some(
      (measure) => measure.id === judge.measure && measure.version === judge.version,
    )
  )
    throw new Error("the judge measure and version are absent from the stored plan");
  verifyRatingJudge(run.run, judge);
  const judges = new Map<string, MeasureValue>();
  for (const value of run.values) {
    if (
      value.measure !== judge.measure ||
      value.version !== judge.version ||
      value.source !== "judge" ||
      !value.applicable
    )
      continue;
    if (judges.has(value.trial))
      throw new Error("a trial has multiple applicable values for the judge measure");
    judges.set(value.trial, value);
  }
  const trialById = new Map(run.trials.map((trial) => [trial.id, trial]));
  const armRoles = new Map(run.plan.arms.map((arm) => [arm.name, arm.role]));
  const seen = new Set<string>();
  const trials = new Set<string>();
  const configurations = new Set<string>();
  const strata = new Map<string, string>();
  const units: RatingsImport["units"] = [];
  const values: ImportedHumanValue[] = [];
  for (const task of tasks) {
    const id = task.data.item_id;
    const entry = Object.hasOwn(key, id) ? key[id] : undefined;
    if (!entry) throw new Error("an export item is missing from the key file");
    if (seen.has(id) || trials.has(entry.trial))
      throw new Error("the export repeats an item or trial");
    seen.add(id);
    trials.add(entry.trial);
    const trial = trialById.get(entry.trial);
    if (!trial?.arm || !trial.case)
      throw new Error("a key entry names a trial missing from the run");
    const role = entry.configuration === "known-worse" ? "reference" : entry.configuration;
    if (armRoles.get(trial.arm) !== role)
      throw new Error("a key entry has the wrong configuration role");
    if (strata.has(trial.case) && strata.get(trial.case) !== entry.stratum)
      throw new Error("a case is in conflicting strata");
    strata.set(trial.case, entry.stratum);
    const judgeRating = judges.get(entry.trial);
    const label = judgeRating?.value;
    if (
      !judgeRating ||
      label?.type !== "level" ||
      !scale.some((rating) => String(rating) === label.level)
    )
      throw new Error("an item needs a stored judge level on the registered scale");
    if (classRank(judgeRating.dataClass) > classRank(dataClass))
      throw new Error("a judge rating exceeds the study’s data class");
    configurations.add(entry.configuration);

    const labels = readAnnotations(task, registration, levels);
    const imported = (rater: Study["raters"][number]): ImportedHumanValue => {
      const level = labels.get(rater.user);
      if (level === undefined) throw new Error("each item needs both registered raters’ scores");
      return ImportedHumanValue.parse({
        schema: "ichnaea.measureValue/1",
        trial: entry.trial,
        measure: rater.measure,
        version: rater.version,
        dataClass,
        source: "human",
        applicable: true,
        value: { type: "level", level: String(level) },
      });
    };
    const first = imported(raters[0]);
    const second = imported(raters[1]);
    values.push(first, second);
    units.push({
      trial: entry.trial,
      item: trial.case,
      stratum: entry.stratum,
      configuration: entry.configuration,
      judge: label.level,
    });
  }
  for (const id of Object.keys(key))
    if (!seen.has(id)) throw new Error("a key entry is missing from the export");
  if (!configurations.has("base") || !configurations.has("candidate"))
    throw new Error("calibration needs base and candidate ratings");

  const ratings = RatingsImport.parse({
    schema: "ichnaea.ratingsImport/1",
    run: input.run,
    study,
    source: "label-studio",
    registration: await digest(registration),
    dataClass,
    judge,
    scale,
    values,
    raters: raters.map(({ measure, version }) => ({ measure, version })),
    units,
  });
  await store.writeRatings(ratings);
  return ratings;
}
