import * as z from "zod";

import { none } from "../data-class.ts";
import { Digest, SuiteId, Text } from "../primitives.ts";
import { Pool } from "./case.ts";
import { MeasureIdentity } from "./measure-identity.ts";
import { PrimaryRegistration } from "./lock-vocabulary.ts";
import {
  Command,
  CommitSha,
  ConfigName,
  Exposure,
  GitRepo,
  HttpsPath,
  JsonScalar,
} from "./setup.ts";

/**
 * Where a locked source came from. An HTTPS source whose URL the environment holds is recorded by
 * its host and path only.
 */
export const LockedOrigin = z.xor([
  z.strictObject({
    dataset: none(ConfigName.describe("The dataset.")),
    path: none(Text.describe("The case file inside the dataset.")),
  }),
  z.strictObject({ file: none(Text.describe("The file.")) }),
  z.strictObject({
    git: z
      .strictObject({
        repo: none(GitRepo.describe("The repository.")),
        commit: none(CommitSha.describe("The full commit.")),
        path: none(Text.describe("The path in the repository.")).optional(),
      })
      .describe("A git source."),
  }),
  z.strictObject({
    https: z
      .strictObject({
        host: none(
          z
            .string()
            .regex(/^[^\s/?#@]+$/)
            .describe("The host, with no user information."),
        ),
        path: none(HttpsPath.describe("The path, with no query, fragment or known token format.")),
      })
      .describe("An HTTPS source, by host and path."),
  }),
  z.strictObject({
    command: none(Command.describe("The command.")),
    output: none(Text.describe("What the command wrote.")),
  }),
]);

/** A case source as the lock pins it: its digest, its size and its cases per pool. */
export const LockedSource = z.strictObject({
  origin: LockedOrigin.describe("Where the source came from."),
  digest: none(Digest.describe("The source's digest.")),
  bytes: none(z.int().min(0).describe("The source's size in bytes.")),
  pools: none(z.partialRecord(Pool, z.int().min(0)).describe("The number of cases in each pool.")),
});

/** A dataset as the lock pins it: its commit, and the exposure of the place where it lives. */
export const LockedDataset = z.strictObject({
  commit: none(CommitSha.describe("The dataset's commit, for a git dataset.")).optional(),
  place: none(
    Exposure.exclude(["sealed"]).describe(
      "public only when the place answered an anonymous HTTPS request with 200; otherwise private.",
    ),
  ),
});

/** A model judge's identity, as the lock pins it. */
export const JudgeIdentity = z.strictObject({
  model: none(Text.describe("The model, with its revision.")),
  parameters: none(
    z.record(Text, JsonScalar).describe("The sampling parameters, as JSON scalars."),
  ),
  prompt: none(Digest.describe("The prompt's digest.")),
  rubric: none(Digest.describe("The rubric's digest.")),
  inputsDigest: none(Digest.describe("The digest of what the judge is shown.")),
});

/** An instrument's pin: the tree digest of its files, its image and its judge identity. */
export const InstrumentPin = z.strictObject({
  files: none(Digest.describe("The tree digest of the instrument's tracked files.")).optional(),
  image: z
    .strictObject({
      reference: none(Text.describe("The image reference that the suite names.")),
      digest: none(Digest.describe("The image's registry digest.")),
    })
    .describe("The grading image.")
    .optional(),
  judge: JudgeIdentity.describe(
    "The judge identity, when the instrument is a model judge.",
  ).optional(),
  imported: z
    .strictObject({
      version: none(Text.describe("The version.")),
      digest: none(Digest.describe("The digest.")),
    })
    .describe("An imported instrument's version and digest.")
    .optional(),
});

/**
 * The lock of a suite (`ichnaea.suite.lock/1`), written by `ichnaea lock` beside the suite. It is
 * stale when the measurement digest, a source, a dataset, an instrument pin, a limit, or a
 * measure's definition or implementation differs from the suite and the checkout
 * (`staleLockEntries`). Runtimes are not in the lock; each run's plan records them.
 */
export const SuiteLock = z.strictObject({
  schema: none(
    z.literal("ichnaea.suite.lock/1").describe("The record type and its major version."),
  ),
  suite: none(SuiteId.describe("The suite that the lock belongs to.")),
  suiteDigest: none(Digest.describe("The digest of the suite's canonical JSON.")),
  measurementDigest: none(
    Digest.describe("The digest of the parts of the suite that change what is measured."),
  ),
  sources: z.array(LockedSource).describe("Each case source."),
  datasets: z
    .record(ConfigName, LockedDataset)
    .describe("Each dataset that the sources read.")
    .optional(),
  instruments: z.record(ConfigName, InstrumentPin).describe("Each instrument's pin."),
  measures: z
    .record(ConfigName, MeasureIdentity)
    .describe("Each measure's identity: the digests of its definition and of its implementation."),
  limits: z
    .record(ConfigName, PrimaryRegistration)
    .describe(
      "A copy of the primary measures' limits, owners and reasons, derived from the suite. The plan's preregistration is a separate record field.",
    ),
});
/** A suite lock. */
export type SuiteLock = z.infer<typeof SuiteLock>;
