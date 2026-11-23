import * as z from "zod";

import { CLOSED_KEY, none } from "../data-class.ts";
import {
  CaseId,
  MeasureId,
  PlanDigest,
  Probability,
  RunId,
  SemVer,
  Text,
  Timestamp,
  TrialId,
} from "../primitives.ts";
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

const reductionCounts = {
  validTrials: none(z.int().min(0)),
  plannedTrials: none(z.int().min(1)),
};

/** What the registered reduction found for one planned case. */
const CaseReduction = z.discriminatedUnion("status", [
  z.strictObject({ case: none(CaseId), ...reductionCounts, status: none(z.literal("missing")) }),
  z.strictObject({
    case: none(CaseId),
    ...reductionCounts,
    status: none(z.enum(["observed", "estimate-only"])),
    passAll: none(Probability),
    passAny: none(Probability),
  }),
]);

/** The case results and their equal-weight summary for a one-arm run. */
export const RunReduction = z.strictObject({
  cases: z.array(CaseReduction).min(1),
  overall: z.discriminatedUnion("status", [
    z.strictObject({ status: none(z.literal("missing")) }),
    z.strictObject({
      status: none(z.enum(["observed", "estimate-only"])),
      passAll: none(Probability),
      passAny: none(Probability),
    }),
  ]),
});
/** Stored values for pass^k and pass@k. */
export type RunReduction = z.infer<typeof RunReduction>;

/** The case counts and bound from one registered detector. */
const MustNeverResult = z.strictObject({
  measure: none(MeasureId),
  hits: none(z.int().min(0)),
  clean: none(z.int().min(0)),
  missing: none(z.int().min(0)),
  cases: z
    .array(
      z.strictObject({
        case: none(CaseId),
        trials: none(z.int().min(1)),
      }),
    )
    .min(1),
  claim: z.strictObject({
    status: none(z.enum(["shown", "not-shown", "no-claim", "flagged-only"])),
    bound: none(Probability.nullable()),
    level: none(Probability),
    method: none(z.literal("clopper-pearson-adjusted")),
  }),
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
  trialReduction: RunReduction.optional(),
  mustNever: z.array(MustNeverResult).min(1).optional(),
  /** The earlier one-arm run selected for the quantity comparison when this run was stored. */
  previousRun: none(RunId).optional(),
  startedAt: none(Timestamp),
  completedAt: none(Timestamp).optional(),
});
/** A run. */
export type Run = z.infer<typeof Run>;
