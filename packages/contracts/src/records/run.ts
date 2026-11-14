import * as z from "zod";

import { none } from "../data-class.ts";
import { PlanDigest, RunId, SemVer, Timestamp, TrialId } from "../primitives.ts";
import { LineageItem } from "./plan.ts";
import { Outcome } from "./trial.ts";

/** The state of one planned trial in the ledger (REQ-19). */
export const LedgerEntry = z.object({
  trial: none(TrialId),
  state: none(z.enum(["planned", "running", "recorded"])),
  outcome: none(Outcome).optional(),
});

/** A run: the ledger of a plan's trials with the lineage of everything that can change a verdict. */
export const Run = z.object({
  schema: none(z.literal("ichnaea.run/1")),
  id: none(RunId),
  plan: none(PlanDigest),
  exploratory: none(z.boolean()),
  environment: z.object({
    node: none(z.string().min(1)),
    platform: none(z.string().min(1)),
    ichnaea: none(SemVer),
    ci: none(z.string().min(1)).optional(),
  }),
  lineage: z.array(LineageItem),
  ledger: z.array(LedgerEntry),
  startedAt: none(Timestamp),
  completedAt: none(Timestamp).optional(),
});
/** A run. */
export type Run = z.infer<typeof Run>;
