import * as z from "zod";

import { PairDrawRecord } from "../block-order.ts";
import { CLOSED_KEY, none } from "../data-class.ts";
import {
  Digest,
  MeasureId,
  PlanDigest,
  RunId,
  Seed,
  SemVer,
  Text,
  Timestamp,
  TrialId,
} from "../primitives.ts";
import { CandidateHistory, Registration, RunFailure } from "./run-registration.ts";
import { Arm, LineageItem } from "./plan.ts";
import { Outcome } from "./trial.ts";

/** The runtime that computed a record: its name, version, operating system and architecture. */
export const Runtime = z.strictObject({
  name: none(Text),
  version: none(Text),
  platform: none(Text),
  arch: none(Text),
});
/** A runtime. */
export type Runtime = z.infer<typeof Runtime>;

/** The state of one planned trial in the ledger (REQ-19). */
export const LedgerEntry = z.strictObject({
  trial: none(TrialId),
  state: none(z.enum(["planned", "running", "recorded"])),
  outcome: none(Outcome, { [CLOSED_KEY]: true }).optional(),
});

/** The arm-order draw and final state of one physical block. */
export const ExecutedBlock = z.strictObject({
  block: none(z.int().nonnegative()),
  plannedBlock: none(z.int().nonnegative()),
  first: none(z.enum(["base", "candidate"])).optional(),
  draws: z.array(PairDrawRecord).optional(),
  status: none(z.enum(["complete", "abandoned"])),
});
/** A recorded arm-order draw and final block state. */
export type ExecutedBlock = z.infer<typeof ExecutedBlock>;

/**
 * A run: the ledger of a plan's trials, the configurations it ran (with their identities, so a
 * run without a model identity or a generation parameter does not validate), and the lineage of
 * everything that can change a verdict.
 */
export const Run = z.strictObject({
  schema: none(z.literal("ichnaea.run/1")),
  id: none(RunId),
  plan: none(PlanDigest),
  exploratory: none(z.boolean()),
  /** The execution receipt: the source, locked seed and draws of physical blocks. */
  execution: z
    .strictObject({
      source: none(z.enum(["runner", "import", "re-score"])),
      analysisPlan: none(Digest),
      seed: Seed.optional(),
      blocks: z.array(ExecutedBlock).optional(),
      registration: Registration.optional(),
      history: CandidateHistory.optional(),
      failure: none(RunFailure).optional(),
    })
    .optional(),
  /** Counts of supplied applicable values that the writer dropped outside the locked mask. */
  valuesOutsideMask: none(z.record(MeasureId, z.int().positive())).optional(),
  environment: z.strictObject({
    node: none(Text),
    platform: none(Text),
    ichnaea: none(SemVer),
    ci: none(Text).optional(),
    /** The processor architecture, for example `x64` (`process.arch` in Node). */
    arch: none(Text).optional(),
    /**
     * The runtime that computed the run's records. A recompute on the same runtime must give the
     * same bytes; on another runtime it is a new computation (REQ-83).
     */
    runtime: Runtime.optional(),
  }),
  arms: z.array(Arm).min(1),
  lineage: z.array(LineageItem),
  ledger: z.array(LedgerEntry),
  startedAt: none(Timestamp),
  completedAt: none(Timestamp).optional(),
});
/** A run. */
export type Run = z.infer<typeof Run>;
