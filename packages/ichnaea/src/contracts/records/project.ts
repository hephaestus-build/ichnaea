import * as z from "zod";

import { none } from "../data-class.ts";
import { Probability, Text } from "../primitives.ts";
import {
  Duration,
  Endpoint,
  Exposure,
  FromEnv,
  ConfigName,
  RunLimits,
  CompareMode,
  DataSource,
  WorkerSettings,
} from "./setup.ts";

/** A purpose of processing, such as `PU-3` (human rating of real content). */
export const PurposeId = z.string().regex(/^PU-[1-9][0-9]{0,2}$/);

/**
 * Where stored baselines come from: the local store, or a successful `push` run of a named
 * workflow on the base branch of this repository.
 */
export const BaselineSource = z.xor([
  none(z.literal("store").describe("The local store.")),
  z.strictObject({
    githubArtifact: z
      .strictObject({
        workflow: none(Text.describe("The workflow file that records baselines.")),
        branch: none(Text.describe("The base branch.")),
      })
      .describe("The artifacts of a successful push run of the workflow on the branch."),
  }),
]);

/** Stored baselines: where they come from, how old they may be, and the drift sentinel. */
export const Baselines = z.strictObject({
  from: BaselineSource.describe("Where stored baselines come from. Default store.").optional(),
  freshness: none(Duration.describe("The oldest stored baseline to use. Default P7D.")).optional(),
  maxFreshness: none(
    Duration.describe("The largest freshness that a suite may set. Default P30D."),
  ).optional(),
  sentinel: z
    .strictObject({
      share: none(
        Probability.describe("The share of base cases that each fast run re-runs. Default 0.1."),
      ).optional(),
      min: none(
        z.int().min(5).describe("The fewest complete sentinel cases. At least 5, and the default."),
      ).optional(),
    })
    .describe("The sample of base cases that a fast run re-runs to detect drift.")
    .optional(),
});

/** A grant that lets a sink receive private content: exposure, purpose and reason. */
export const Clearance = z.strictObject({
  maxExposure: none(Exposure.describe("The highest exposure that the sink may receive.")),
  purpose: none(PurposeId.describe("The purpose under which it receives it.")),
  reason: none(Text.describe("Why the sink needs it.")),
});

const sinkUrl = FromEnv.describe("The sink's URL, a bearer secret, from the environment.");
const sinkClearance = Clearance.describe("A grant above the sink's default clearance.");

/**
 * A destination for a run's card, tagged by its kind. A local sink (`console`, `file`) and the
 * `github` sink, which uses the job's token, take no URL. Every other remote sink reads its URL
 * from the environment, and a `webhook` also signs with a key from the environment (Standard
 * Webhooks). Only a `github` sink and a `webhook` sink may take a clearance grant above class none
 * and exposure public; no grant raises a Teams, Slack or OTLP sink.
 */
export const SinkSettings = z.discriminatedUnion("kind", [
  z.strictObject({ kind: none(z.literal("console")) }),
  z.strictObject({ kind: none(z.literal("file")) }),
  z.strictObject({ kind: none(z.literal("github")), clearance: sinkClearance.optional() }),
  z.strictObject({ kind: none(z.literal("teams-workflow")), url: sinkUrl }),
  z.strictObject({ kind: none(z.literal("slack")), url: sinkUrl }),
  z.strictObject({
    kind: none(z.literal("webhook")),
    url: sinkUrl,
    signingKey: FromEnv.describe("The Standard Webhooks signing key, from the environment."),
    clearance: sinkClearance.optional(),
  }),
  z.strictObject({ kind: none(z.literal("otlp")), url: sinkUrl }),
]);

/** Which sinks receive the card of an event. */
export const DeliveryRoute = z.strictObject({
  on: none(
    z
      .enum(["estimate", "compare", "noise", "calibrate", "attribute", "monitor", "monitor.alert"])
      .describe("The event."),
  ),
  profile: none(ConfigName.describe("Only runs of this profile.")).optional(),
  to: none(z.array(ConfigName).min(1).describe("The sinks.")),
  required: none(
    z.boolean().describe("A failed delivery changes the exit code. Default false."),
  ).optional(),
});

/** One purpose of processing that the home enables, with its legal basis and its record. */
export const PurposeGrant = z.strictObject({
  enabled: none(z.boolean().describe("Whether commands may run for the purpose.")),
  basis: none(
    z
      .enum(["consent", "public-task"])
      .describe("The legal basis, which decides who runs: consented, or also listed, subjects."),
  ),
  record: none(Text.describe("The record that documents the processing, such as a DPIA.")),
});

/** A model endpoint that the home registers for content above class none. */
export const GovernedEndpoint = z.strictObject({
  provider: none(Text.describe("The provider.")),
  region: none(Text.describe("The region.")),
  purposes: none(z.array(PurposeId).describe("The purposes that may send content to it.")),
  trainsOnInputs: none(
    z.boolean().describe("Whether the provider trains on inputs. Sealed content needs false."),
  ).optional(),
});

/** The governance of data above class none. It belongs in the home project config only. */
export const Governance = z.strictObject({
  home: z
    .strictObject({ description: none(Text.describe("Where the home is.")) })
    .describe("The place inside the controller's trust boundary where runs on real data happen."),
  purposes: z.record(PurposeId, PurposeGrant).describe("The enabled purposes."),
  endpoints: z
    .record(ConfigName, GovernedEndpoint)
    .describe("The registered endpoints.")
    .optional(),
  retention: z
    .strictObject({
      pseudonymous: none(Duration.describe("How long pseudonymous data is kept.")).optional(),
      personal: none(Duration.describe("How long personal data is kept.")).optional(),
      labels: none(
        z.record(ConfigName, Duration).describe("How long each study's labels are kept."),
      ).optional(),
    })
    .describe("How long data above class none is kept.")
    .optional(),
});

/**
 * The project config (`ichnaea.project/1`): what several suites share, as plain JSON data. It is the
 * canonical form of an `ichnaea.config.ts` or `ichnaea.config.jsonc` file.
 */
export const ProjectConfig = z.strictObject({
  $schema: none(
    Text.describe("The JSON Schema of this file, for editors. A JSONC project file carries it."),
  ).optional(),
  schema: none(z.literal("ichnaea.project/1").describe("The record type and its major version.")),
  suites: none(
    z
      .array(Text)
      .describe('Globs of suite files. Default ["suites/*/suite.ts", "suites/*/suite.jsonc"].'),
  ).optional(),
  datasets: z
    .record(ConfigName, DataSource)
    .describe("Named datasets. Each source holds a dataset.json at its root.")
    .optional(),
  workers: z
    .record(ConfigName, WorkerSettings)
    .describe("Named workers that suites reference.")
    .optional(),
  endpoints: z
    .record(ConfigName, Endpoint)
    .describe("Named model endpoints and their budgets.")
    .optional(),
  store: z
    .strictObject({
      path: none(Text.describe("The store directory. Default .ichnaea.")).optional(),
    })
    .describe("The local store of runs, records and artifacts.")
    .optional(),
  baselines: Baselines.optional(),
  defaults: z
    .strictObject({
      trials: none(z.int().min(1).describe("Trials per case per version. Default 2.")).optional(),
      mode: none(CompareMode.describe("fast or confirm. Default fast.")).optional(),
      profile: none(
        ConfigName.describe("The profile that runs by default. Default pr."),
      ).optional(),
      limits: RunLimits.optional(),
    })
    .describe("Defaults that a suite, a profile or a flag overrides.")
    .optional(),
  delivery: z
    .strictObject({
      sinks: z.record(ConfigName, SinkSettings).describe("Named sinks.").optional(),
      routes: z.array(DeliveryRoute).describe("Which sinks receive which events.").optional(),
    })
    .describe("Where cards go. Default: the console and file sinks.")
    .optional(),
  history: none(
    z.array(Text).describe("Directories of earlier runs that counts and trends read."),
  ).optional(),
  privacy: z
    .strictObject({
      homeKey: FromEnv.describe(
        "The owner's secret key for keyed aliases, from the environment.",
      ).optional(),
      consent: none(Text.describe("The path of the consent list, never the list.")).optional(),
      governance: Governance.optional(),
    })
    .describe("Privacy settings.")
    .optional(),
});
/** A project config. */
export type ProjectConfig = z.infer<typeof ProjectConfig>;
