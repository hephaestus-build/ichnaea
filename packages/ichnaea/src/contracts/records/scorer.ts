import * as z from "zod";

import { attribute, content, none } from "../data-class.ts";
import {
  CaseId,
  Duration,
  Json,
  RecordDataClass,
  ScoreRequestId,
  Text,
  TrialId,
} from "../primitives.ts";
import { StageEvent } from "./worker.ts";

/**
 * One trial to score: its delivered output, a writable copy of its artifacts and its stage events.
 */
export const ScoreUnit = z.strictObject({
  /** The trial that delivered the output. */
  trial: none(TrialId),
  /** The trial's raw output. */
  output: content(Json).optional(),
  /**
   * The trial's artifacts, as a writable copy made for this request, never a path into the cache,
   * so a build can run inside them.
   */
  artifacts: z
    .array(
      z.strictObject({
        /** The artifact's name in the trial result. The worker chose it. */
        name: attribute(Text),
        /** Where the writable copy is. It can hold the artifact's name. */
        path: attribute(Text),
      }),
    )
    .optional(),
  /** The trial's raw stage events. */
  events: z.array(StageEvent).optional(),
});
/** A unit to score. */
export type ScoreUnit = z.infer<typeof ScoreUnit>;

/**
 * What Ichnaea sends a scorer process: one JSON line on its standard input. The scorer runs from a
 * copy of the base's pinned files, so both arms are measured the same way. One request can score
 * several measures on several trials of one case. Unlike a trial request, it carries the case's
 * references.
 */
export const ScoreRequest = z.strictObject({
  schema: none(z.literal("ichnaea.scoreRequest/1")),
  /** The request's ID, unique in the run. Its result echoes it, and a `cancel` names it. */
  id: none(ScoreRequestId),
  /** The data class of the request's content: at least the case's. */
  dataClass: none(RecordDataClass),
  /** The instrument's ID in the suite. */
  instrument: none(Text),
  /**
   * The time limit for the request. A hanging build or test that the scorer runs is a measured
   * failure within it, not an error of the scorer.
   */
  deadline: none(Duration),
  /** The instrument's settings from the suite, such as a judge's model and temperature. */
  settings: none(z.record(z.string(), Json)).optional(),
  /** The measures to score, each by its ID in the suite. */
  measures: z
    .array(
      z.strictObject({
        /** The measure's ID in the suite. */
        id: none(Text),
        /** The dimension that the instrument scores for the measure, such as `correctness`. */
        dimension: none(Text).optional(),
      }),
    )
    .min(1),
  /** The case that the trials ran, with its hidden references. */
  case: z.strictObject({
    /** The case's ID. */
    id: none(CaseId),
    /** The case's input, as the base suite's cases hold it. */
    input: content(z.record(z.string(), Json)),
    /** The case's hidden references. A worker never receives them. */
    references: content(z.record(z.string(), Json)).optional(),
  }),
  /** A writable directory for the request, removed afterwards. */
  scratch: none(Text),
  /** The trials to score. */
  units: z.array(ScoreUnit).min(1),
});
/** A score request. */
export type ScoreRequest = z.infer<typeof ScoreRequest>;

/**
 * A raw value as a scorer gives it: a boolean for a binary measure, a number for a score or a
 * quantity, a level's name, or a proportion of items inside the trial. A number is finite: NaN and
 * the infinities are not JSON, so a scorer that computes one reports the value as missing with
 * reason `NON_FINITE`. A schema cannot compare two fields, so a proportion whose numerator exceeds
 * its denominator validates here, and Ichnaea refuses it when it reads the value.
 */
export const ScoredValue = z.union([
  z.boolean(),
  z.number(),
  Text,
  z.strictObject({
    /** The items that pass. */
    numerator: none(z.int().min(0)),
    /** The items counted. */
    denominator: none(z.int().min(1)),
  }),
]);
/** A scored value. */
export type ScoredValue = z.infer<typeof ScoredValue>;

/** What the instrument observed while it scored: the model that answered and its responses. */
export const ScoreObserved = z.strictObject({
  /** The model identity that answered, for a judge. */
  model: none(Text).optional(),
  /**
   * The provider's response ID of every call that returned one. An ID can fetch the response from
   * the provider, so it has the class of the record's content.
   */
  responseIds: attribute(z.array(Text)),
});
/** What a scorer observed. */
export type ScoreObserved = z.infer<typeof ScoreObserved>;

/**
 * Why an instrument failed, by class:
 * - `infrastructure`: the instrument's endpoint or sandbox failed. Ichnaea retries it, then the
 *   value is missing;
 * - `protocol`: the request broke the protocol, for example kind `bad-request`. The run is INVALID.
 *
 * The worker classes `system` and `not_run` do not apply: the system's own failure is a value
 * (`ok`, `false`, with a `why`), and an instrument that cannot give a value and must not be
 * retried returns `missing`. Whoever reads a result treats any other class as a protocol failure.
 */
export const ScoreFailure = z.strictObject({
  /** The failure's class. */
  class: none(z.enum(["infrastructure", "protocol"])),
  /** A short, stable kind, such as `timeout` or `bad-request`. */
  kind: none(Text),
  /** A human-readable message. It may contain content from the instrument. */
  message: content(z.string()).optional(),
});
/** A scorer failure. */
export type ScoreFailure = z.infer<typeof ScoreFailure>;

const unit = {
  /** The trial that the value belongs to. */
  trial: none(TrialId),
  /** The measure's ID in the suite. */
  measure: none(Text),
  /** What the instrument observed while it scored. */
  observed: ScoreObserved.optional(),
};

/**
 * One value for one trial and one measure, by status:
 * - `ok`: the value;
 * - `not_applicable`: the measure does not apply to the trial. It is neither a zero nor missing;
 * - `error`: the instrument failed, with class `infrastructure` (retried, then missing) or
 *   `protocol` (the run is INVALID). When the request's unit identities parse but the request is
 *   wrong, the scorer echoes each unit with class `protocol` and kind `bad-request`;
 * - `missing`: the instrument gave no value and must not be retried, with a reason, such as a
 *   judge reply that does not parse.
 *
 * A value that a scorer did not give is missing, never a zero.
 */
export const UnitScore = z.discriminatedUnion("status", [
  z.strictObject({
    ...unit,
    status: none(z.literal("ok")),
    /** The value. */
    value: none(ScoredValue),
    /** Why the instrument gave the value, such as a judge's rationale. */
    why: content(z.string()).optional(),
  }),
  z.strictObject({
    ...unit,
    status: none(z.literal("not_applicable")),
    /** Why the measure does not apply. */
    why: content(z.string()).optional(),
  }),
  z.strictObject({
    ...unit,
    status: none(z.literal("error")),
    /** Why the instrument failed, by class. */
    failure: ScoreFailure,
  }),
  z.strictObject({
    ...unit,
    status: none(z.literal("missing")),
    /** A short, stable reason, such as `JUDGE_REPLY_UNPARSABLE`. It never quotes content. */
    reason: none(Text),
    /** What the instrument could not read, in its own words. */
    why: content(z.string()).optional(),
  }),
]);
/** One scored unit. */
export type UnitScore = z.infer<typeof UnitScore>;

/**
 * What a scorer answers for one score request: one JSON line on its standard output, with a value
 * per trial and measure. Ichnaea matches the result to its request by `request`, and each value by
 * trial and measure, never by position. For a request line without readable unit identities, the scorer writes an
 * `ichnaea.workerError/1` line instead, and the run stops.
 */
export const ScoreResult = z.strictObject({
  schema: none(z.literal("ichnaea.scoreResult/1")),
  /** The `id` of the request that this answers. */
  request: none(ScoreRequestId),
  /** The data class of the result's content: at least the request's. */
  dataClass: none(RecordDataClass),
  /** One entry per trial and measure of the request. */
  values: z.array(UnitScore).min(1),
});
/** A score result. */
export type ScoreResult = z.infer<typeof ScoreResult>;
