import { readFile } from "node:fs/promises";
import * as z from "zod";

import { classRank } from "../contracts/data-class.ts";
import { digest } from "../contracts/canonical.ts";
import { MeasureId, RecordDataClass, SemVer, Text, TrialId } from "../contracts/primitives.ts";
import { ImportedHumanValue, RatingJudge, RatingsImport } from "../contracts/records/ratings.ts";

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
  if (!parsed.success)
    throw new Error(
      `invalid record in '${file}' at ${parsed.error.issues[0]?.path.join(".") || "root"}`,
    );
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
  const { raters, scale, dataClass, control, study, judge } = registration;
  if (new Set(scale).size !== scale.length)
    throw new Error("the registered scale repeats a rating");
  if (raters[0].user === raters[1].user || raters[0].measure === raters[1].measure)
    throw new Error("the two registered raters need distinct users and measure IDs");
  const levels = new Map(scale.map((rating, index) => [rating, index + 1]));
  const levelOf = (rating: number, item: string): number => {
    const level = levels.get(rating);
    if (level === undefined)
      throw new Error(`item '${item}' has a rating outside the registered scale`);
    return level;
  };
  if (
    !run.plan.measures.some(
      (measure) => measure.id === judge.measure && measure.version === judge.version,
    )
  )
    throw new Error("the judge measure and version are absent from the stored plan");
  const lineage = run.run.lineage.filter((item) => item.kind === "judge");
  if (
    lineage.length &&
    !lineage.some((item) => item.id === judge.id && item.digest === judge.digest)
  )
    throw new Error("the judge does not match the stored run lineage");
  const judges = new Map(
    run.values
      .filter(
        (value) =>
          value.measure === judge.measure &&
          value.version === judge.version &&
          value.source === "judge" &&
          value.applicable,
      )
      .map((value) => [value.trial, value]),
  );
  const trialById = new Map(run.trials.map((trial) => [trial.id, trial]));
  const armRoles = new Map(run.plan.arms.map((arm) => [arm.name, arm.role]));
  const seen = new Set<string>();
  const trials = new Set<string>();
  const configurations = new Set<string>();
  const strata = new Map<string, string>();
  const units: RatingsImport["calibration"]["units"] = [];
  const values: ImportedHumanValue[] = [];
  for (const task of tasks) {
    const id = task.data.item_id;
    const entry = Object.hasOwn(key, id) ? key[id] : undefined;
    if (!entry) throw new Error(`item '${id}' is missing from the key file`);
    if (seen.has(id) || trials.has(entry.trial))
      throw new Error(`item '${id}' repeats an item ID or trial`);
    seen.add(id);
    trials.add(entry.trial);
    const trial = trialById.get(entry.trial);
    if (!trial?.arm || !trial.case)
      throw new Error(`item '${id}' names a trial missing from run '${input.run}'`);
    const role = entry.configuration === "known-worse" ? "reference" : entry.configuration;
    if (armRoles.get(trial.arm) !== role)
      throw new Error(`item '${id}' has the wrong configuration role`);
    if (strata.has(trial.case) && strata.get(trial.case) !== entry.stratum)
      throw new Error(`item '${id}' is in conflicting strata`);
    strata.set(trial.case, entry.stratum);
    const judgeRating = judges.get(entry.trial);
    const label = judgeRating?.value;
    if (
      !judgeRating ||
      label?.type !== "level" ||
      !scale.some((rating) => String(rating) === label.level)
    )
      throw new Error(`item '${id}' needs a stored judge level on the registered scale`);
    if (classRank(judgeRating.dataClass) > classRank(dataClass))
      throw new Error(`item '${id}' has a judge rating above the study's data class`);
    configurations.add(entry.configuration);

    const labels = new Map<number, number>();
    for (const annotation of task.annotations) {
      if (annotation.was_cancelled) continue;
      const user =
        typeof annotation.completed_by === "object"
          ? annotation.completed_by.id
          : annotation.completed_by;
      if (!user || !raters.some((rater) => rater.user === user))
        throw new Error(`item '${id}' has an annotation from an unregistered rater`);
      if (labels.has(user)) throw new Error(`item '${id}' repeats a rater's annotation`);
      const ratings = annotation.result.filter((result) => result.from_name === control);
      const rating = ratings[0];
      const number = NumberResult.safeParse(rating?.value);
      if (ratings.length !== 1 || rating?.type !== "number" || !number.success)
        throw new Error(`item '${id}' needs one numeric annotation for '${control}' per rater`);
      labels.set(user, levelOf(number.data.number, id));
    }
    const first = labels.get(raters[0].user);
    const second = labels.get(raters[1].user);
    if (first === undefined || second === undefined)
      throw new Error(`item '${id}' needs a rating from each registered rater`);
    const scores = [first, second] as const;
    for (const [slot, rater] of raters.entries()) {
      values.push(
        ImportedHumanValue.parse({
          schema: "ichnaea.measureValue/1",
          trial: entry.trial,
          measure: rater.measure,
          version: rater.version,
          dataClass,
          source: "human",
          applicable: true,
          value: { type: "level", level: String(scores[slot]) },
        }),
      );
    }
    units.push({
      item: trial.case,
      stratum: entry.stratum,
      configuration: entry.configuration,
      weight: 1,
      raters: [...scores],
      judge: levelOf(Number(label.level), id),
    });
  }
  for (const id of Object.keys(key))
    if (!seen.has(id)) throw new Error(`item '${id}' is missing from the export`);
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
    calibration: { scale: "levels", levels: scale.length, units },
  });
  await store.writeRatings(ratings);
  return ratings;
}
