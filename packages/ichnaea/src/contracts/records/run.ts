import * as z from "zod";

import { CLOSED_KEY, none } from "../data-class.ts";
import { PlanDigest, RunId, SemVer, Text, Timestamp, TrialId } from "../primitives.ts";
import { Arm, LineageItem } from "./plan.ts";
import { Outcome } from "./trial.ts";

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
  }),
  arms: z.array(Arm).min(1),
  lineage: z.array(LineageItem),
  ledger: z.array(LedgerEntry),
  startedAt: none(Timestamp),
  completedAt: none(Timestamp).optional(),
});
/** A run. */
export type Run = z.infer<typeof Run>;
