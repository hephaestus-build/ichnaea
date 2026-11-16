import * as z from "zod";

import { CLOSED_KEY, none } from "../data-class.ts";
import { PlanDigest, RunId, SemVer, Text, Timestamp, TrialId } from "../primitives.ts";
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
