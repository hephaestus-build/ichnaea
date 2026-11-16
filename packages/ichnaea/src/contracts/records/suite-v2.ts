import * as z from "zod";

import { none } from "../data-class.ts";
import {
  CalendarDate,
  Digest,
  Json,
  Probability,
  RecordDataClass,
  SuiteId,
  Text,
} from "../primitives.ts";
import { Pool } from "./case.ts";
import {
  Command,
  Duration,
  EnvEntry,
  Exposure,
  FromEnv,
  ConfigName,
  JsonScalar,
  RunLimits,
  CompareMode,
  DataSource,
  WorkerSettings,
} from "./setup.ts";

/** What a suite evaluates and what it does not. `doctor` and the card read it; it decides nothing. */
export const SuiteAbout = z.strictObject({
  objective: none(Text.describe("What the evaluated system must do well.")),
  decision: none(Text.describe("The decision that the suite's results inform.")),
  construct: none(Text.describe("What the measures stand for, and what they do not.")),
  scope: none(Text.describe("The inputs that the cases cover.")),
  nonCoverage: none(z.array(Text).describe("What the cases do not cover.")),
  threats: none(z.array(Text).describe("What could make the results wrong.")),
});

/** One case file of a dataset that the project config names. */
export const DatasetFile = z.strictObject({
  dataset: none(ConfigName.describe("A dataset from the project config.")),
  path: none(Text.describe("The case file inside the dataset.")),
});

/**
 * The sampling frame of the cases. Only a measure with the `population` estimand may use it.
 */
export const SamplingFrame = z.strictObject({
  population: none(Text.describe("The population that the cases were drawn from.")),
  drawnBy: none(Text.describe("How the cases were drawn.")),
  date: none(CalendarDate.describe("When the cases were drawn.")),
});

const poolLabel = none(Text.describe("The label that marks the pool's cases, such as dev."));

/**
 * For each pool, the label that marks its cases. Only the validation pool takes a reuse budget:
 * past `maxReads` registered reads since it was frozen, the card says it is over its budget.
 */
export const CasePools = z
  .strictObject({
    development: z.strictObject({ label: poolLabel }).optional(),
    validation: z
      .strictObject({
        label: poolLabel,
        maxReads: none(
          z.int().min(1).describe("The registered reads after which the card warns."),
        ).optional(),
      })
      .optional(),
    sealed: z.strictObject({ label: poolLabel }).optional(),
    promoted: z.strictObject({ label: poolLabel }).optional(),
  })
  .describe("The pools of the cases.");

const casesShape = {
  exposure: none(
    Exposure.describe("Who may see the cases' content. A missing exposure counts as private."),
  ).optional(),
  pools: CasePools.optional(),
  frame: SamplingFrame.optional(),
};

/** Where a suite's cases come from: files of named datasets, or one source. */
export const SuiteCases = z.xor([
  z.strictObject({
    from: z.array(DatasetFile).min(1).describe("Case files of datasets from the project config."),
    ...casesShape,
  }),
  z.strictObject({ source: DataSource.describe("One source of the case files."), ...casesShape }),
]);

/** A module reference: a relative path with no `.` or `..` segment to a JavaScript or TypeScript file. */
export const ModulePath = z
  .string()
  .regex(
    /^(?:[A-Za-z0-9_@+-][A-Za-z0-9._@+-]*\/)*[A-Za-z0-9_@+-][A-Za-z0-9._@+-]*\.(?:ts|mts|js|mjs)$/,
  );

/** Runs another runner and imports what it wrote: a command or a module that writes the batch. */
export const SuiteImport = z.xor([
  z.strictObject({ command: none(Command.describe("A command that writes the import batch.")) }),
  z.strictObject({
    module: none(
      ModulePath.describe("A module that writes the import batch, in the suite's tree."),
    ),
  }),
]);

const factorShape = {
  class: none(RecordDataClass.describe("The data class of what the factor holds.")).optional(),
  exposure: none(
    Exposure.describe("Who may see what the factor holds. A missing exposure counts as private."),
  ).optional(),
};

/**
 * An environment factor: something the system reads that is neither the system nor an
 * instrument, such as an index. It is the same in both arms unless the plan declares it changed.
 */
export const EnvironmentFactor = z.xor([
  z.strictObject({
    path: FromEnv.describe("A path that the environment holds. Ichnaea computes its digest."),
    ...factorShape,
  }),
  z.strictObject({
    service: FromEnv.describe("A service URL that the environment holds."),
    identity: none(
      Text.describe("The name under which the worker reports the service's snapshot ID."),
    ),
    ...factorShape,
  }),
]);

/** The model identity of a judge instrument. Its parameters are part of the judge identity. */
export const JudgeSettings = z.strictObject({
  model: none(Text.describe("The model, with its revision.")),
  prompt: none(Text.describe("The prompt file.")),
  rubric: none(Text.describe("The rubric file.")),
  parameters: none(
    z
      .record(Text, JsonScalar)
      .describe("The sampling parameters, such as temperature, as JSON scalars."),
  ).optional(),
});

/** A model that an instrument downloads at run time, pinned by revision. */
export const PinnedModel = z.strictObject({
  name: none(Text.describe("The model's name.")),
  revision: none(Text.describe("The revision that the instrument downloads.")),
});

/**
 * An instrument: anything that measures, always the base's. It runs from a copy of its `files`,
 * which are globs over tracked files only and include its language's lockfile.
 */
export const InstrumentSettings = z.strictObject({
  command: none(Command.describe("The command that starts the scorer.")).optional(),
  prepare: none(
    Command.describe("A command that runs in the copy before the scorer starts."),
  ).optional(),
  files: none(
    z
      .array(Text)
      .describe("Globs over tracked files that make up the instrument; pinned by digest."),
  ).optional(),
  exclude: none(
    z.array(Text).describe("Globs of artifact files that the scorer's copy leaves out."),
  ).optional(),
  image: none(Text.describe("A grading image. The lock pins its registry digest.")).optional(),
  judge: JudgeSettings.describe(
    "The model identity, when the instrument is a model judge.",
  ).optional(),
  models: z
    .array(PinnedModel)
    .describe("The models that the instrument downloads at run time.")
    .optional(),
  env: z.array(EnvEntry).describe("The environment variables that the scorer may read.").optional(),
  endpoints: none(
    z.array(ConfigName).describe("The endpoints from the project config that the scorer calls."),
  ).optional(),
  imported: z
    .strictObject({
      version: none(Text.describe("The version of the other runner's instrument.")),
      digest: none(Digest.describe("The digest of the other runner's instrument.")),
    })
    .describe("An instrument of another runner, whose values arrive by import.")
    .optional(),
  deadline: none(Duration.describe("The time bound of one score request.")).optional(),
});

/**
 * What computes a measure: a built-in scorer, or an instrument of the suite. A TypeScript measure
 * is a module reference inside its instrument's files, never a function value. Each form has a
 * member that the others lack, so a reader that ignores unknown members still tells them apart.
 */
export const ScorerRef = z.xor([
  z.strictObject({
    builtin: none(ConfigName.describe("The built-in scorer, such as ndcg or links-grounded.")),
    options: none(
      z.record(ConfigName, Json).describe("The built-in scorer's options, such as k for ndcg."),
    ).optional(),
  }),
  z.strictObject({
    instrument: none(ConfigName.describe("The instrument that exports the function.")),
    module: none(ModulePath.describe("The module, relative to the instrument's files.")),
    export: none(Text.describe("The exported function's name.")),
  }),
  z.strictObject({
    instrument: none(ConfigName.describe("The instrument that scores the measure.")),
    dimension: none(
      Text.describe("The dimension of the instrument's report that the measure reads."),
    ),
  }),
]);

/** The cases a measure applies to, fixed before the run: those whose slice is set. */
export const AppliesTo = z.strictObject({
  slice: none(Text.describe("The slice that a case must have.")),
});

/** A reduction over the trials of a case: pass^k (`all`) or pass@k (`any`). Estimate-only. */
export const TrialReduction = z.xor([
  z.strictObject({ all: z.strictObject({ k: none(z.int().min(1).describe("k.")) }) }),
  z.strictObject({ any: z.strictObject({ k: none(z.int().min(1).describe("k.")) }) }),
]);

const measureShape = {
  stage: none(
    ConfigName.describe("The stage whose status or output the measure reads."),
  ).optional(),
  status: none(
    z
      .enum(["ok", "not_invoked", "failed", "skipped", "replayed"])
      .describe("For a stage status measure, the status that counts as true."),
  ).optional(),
  iteration: none(
    z
      .enum(["last", "first", "any", "all"])
      .describe("The iteration of the stage that the measure reads. Default last."),
  ).optional(),
  scorer: ScorerRef.describe("What computes the measure.").optional(),
  appliesTo: AppliesTo.optional(),
  direction: none(z.enum(["higher", "lower"]).describe("Which way is better.")).optional(),
  reduce: TrialReduction.optional(),
  estimand: none(
    z
      .enum(["these-cases", "population"])
      .describe("What an estimate is about. Default these-cases."),
  ).optional(),
  weighting: none(
    z
      .enum(["per-case", "per-family"])
      .describe("How cases weigh in an estimate. Default per-case."),
  ).optional(),
  gate: none(
    z.boolean().describe("A hard gate. It needs deterministic: true on the same measure."),
  ).optional(),
  deterministic: none(
    z.boolean().describe("Every trial of a case in an arm gives the same value."),
  ).optional(),
};

/**
 * How a level measure is tested: as a score when its levels are equally spaced, or as binary with
 * success at or above a cut level registered before the run. With neither, it has no test.
 */
export const LevelSpacing = z.xor([
  none(z.literal("equal").describe("The levels are equally spaced.")),
  z.strictObject({ cut: none(z.number().describe("The lowest level that counts as success.")) }),
]);

/** A measure, by the type of its values. A quantity has a unit and is descriptive only. */
export const MeasureDefinition = z.discriminatedUnion("type", [
  z.strictObject({ type: none(z.literal("binary")), ...measureShape }),
  z.strictObject({ type: none(z.literal("score")), ...measureShape }),
  z.strictObject({
    type: none(z.literal("level")),
    levels: none(
      z.array(z.number()).min(2).describe("The levels in ascending order. lock checks the order."),
    ),
    anchors: none(
      z.record(Text, Text).describe("For a level, the text that anchors it."),
    ).optional(),
    spacing: LevelSpacing.optional(),
    ...measureShape,
  }),
  z.strictObject({
    type: none(z.literal("quantity")),
    unit: none(Text.describe("The unit, such as ms.")),
    ...measureShape,
  }),
]);

/** A primary measure's registration: the largest drop accepted, who set it, and why. */
export const PrimaryRegistration = z.strictObject({
  limit: none(Probability.describe("The largest drop that the owner accepts. It applies to Pass.")),
  owner: none(Text.describe("The role that owns the limit.")),
  reason: none(Text.describe("Why the limit has this value.")),
});

/** Which measures decide, which are reported, and which only explain. */
export const SuitePolicy = z.strictObject({
  primary: z
    .record(ConfigName, PrimaryRegistration)
    .describe("The measures that decide, each with its registered limit."),
  secondary: none(z.array(ConfigName).describe("Measures reported beside the verdict.")).optional(),
  diagnostic: none(z.array(ConfigName).describe("Measures that only explain.")).optional(),
});

/** The call budget of a run. `rejectedPerTrial` defaults to `callsPerTrial`. */
export const SuiteBudget = z.strictObject({
  calls: none(z.int().min(0).describe("The most system calls in a run.")),
  callsPerTrial: none(z.int().min(1).describe("The most system calls in one trial.")),
  rejectedPerTrial: none(
    z.int().min(0).describe("The most calls that the provider may reject in one trial attempt."),
  ).optional(),
  judgeCalls: none(z.int().min(0).describe("The most judge calls in a run.")).optional(),
  costMicros: none(
    z.int().min(0).describe("The most cost in a run, in millionths of the currency unit."),
  ).optional(),
});

/** A profile's budget: any field of the suite budget. */
export const ProfileBudget = SuiteBudget.partial();

/**
 * A named set of run settings. It cannot change the policy, the primary measures or the limits.
 */
export const RunProfile = z.strictObject({
  trials: none(z.int().min(1).describe("Trials per case per version.")).optional(),
  mode: none(CompareMode.describe("fast or confirm.")).optional(),
  pool: none(Pool.describe("The pool that the profile runs.")).optional(),
  cases: none(z.int().min(1).describe("A subset of this many cases.")).optional(),
  budget: ProfileBudget.optional(),
  shards: none(z.int().min(1).describe("How many shards the run is split into.")).optional(),
});

/** The class of a stop reason, as the base maps it. */
export const StopClass = z.enum(["completed", "infrastructure", "system", "not_invoked"]);

/**
 * A stop reason's class. A reason that reports the system's own verdict on its output is
 * `selfVerdict: true` and maps to `completed`.
 */
export const StopMapping = z.xor([
  none(StopClass.describe("The class of the reason.")),
  z.strictObject({
    class: none(StopClass.describe("The class of the reason.")),
    selfVerdict: none(
      z.boolean().describe("The reason reports the system's own verdict on its output."),
    ),
  }),
]);

/**
 * A suite (`ichnaea.suite/2`): one thing you evaluate, as plain JSON data. It is the canonical form
 * of a `suite.ts` or `suite.jsonc` file. Paths are relative to the suite file's directory. Exactly
 * one of `worker` and `import` says how trials are produced.
 */
export const SuiteV2 = z.strictObject({
  $schema: none(
    Text.describe("The JSON Schema of this file, for editors. A JSONC suite file carries it."),
  ).optional(),
  schema: none(z.literal("ichnaea.suite/2").describe("The record type and its major version.")),
  id: none(SuiteId.describe("The suite's stable ID.")),
  version: none(
    Text.describe("A label for people. The suite's identity is its digest."),
  ).optional(),
  about: SuiteAbout.describe("What the suite evaluates and what it does not."),
  cases: SuiteCases.describe("Where the cases come from."),
  worker: z
    .xor([none(ConfigName.describe("A worker from the project config.")), WorkerSettings])
    .describe(
      "The worker that runs the system: a name from the project config, or one written here.",
    )
    .optional(),
  import: SuiteImport.describe("The other runner whose results this suite imports.").optional(),
  configuration: z
    .strictObject({
      record: none(
        z.array(Text).describe("The fields of the arm configuration file that the record keeps."),
      ),
    })
    .describe("What the arm configuration record keeps beside the file's digest.")
    .optional(),
  stages: none(z.array(ConfigName).describe("The stage IDs, in order.")).optional(),
  entry: none(ConfigName.describe("The stage where a stage suite starts.")).optional(),
  environment: z
    .record(ConfigName, EnvironmentFactor)
    .describe("The environment factors that the system reads.")
    .optional(),
  instruments: z
    .record(ConfigName, InstrumentSettings)
    .describe("The instruments, always the base's.")
    .optional(),
  measures: z.record(ConfigName, MeasureDefinition).describe("The measures, by ID."),
  policy: SuitePolicy,
  profiles: z.record(ConfigName, RunProfile).describe("The named run settings.").optional(),
  budget: SuiteBudget,
  limits: RunLimits.optional(),
  baselines: z
    .strictObject({
      freshness: none(
        Duration.describe("The oldest stored baseline to use. Only lower than the project's."),
      ).optional(),
    })
    .describe("How old a stored baseline may be for this suite.")
    .optional(),
  stopReasons: z
    .record(Text, StopMapping)
    .describe("Each raw stop reason's class. An unmapped reason counts as system.")
    .optional(),
  attribute: z
    .strictObject({
      fidelityMargin: none(
        z
          .record(ConfigName, z.number().gt(0).lt(1))
          .describe(
            "For each attributed measure, the largest replay-to-recording difference that still counts as a faithful replay. A measure without an entry uses half its registered limit; attribute applies that default.",
          ),
      ).optional(),
    })
    .describe("Settings for attributing a change to a stage.")
    .optional(),
  deterministic: none(
    z.boolean().describe("The system is declared deterministic. Default false."),
  ).optional(),
});
/** A suite at major 2. */
export type SuiteV2 = z.infer<typeof SuiteV2>;
