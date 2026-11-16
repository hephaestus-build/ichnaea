import * as z from "zod";

import { none } from "../data-class.ts";
import {
  ArmName,
  GateId,
  CaseId,
  CaseSetId,
  ConfigurationIdentity,
  Digest,
  MeasureId,
  RunId,
  Seed,
  SemVer,
  SuiteId,
  Text,
  Timestamp,
  TrialId,
} from "../primitives.ts";
import { Configuration } from "./configuration.ts";
import { CiPolicy, Estimand, PrimaryMeasure } from "./suite.ts";

/** A versioned part that can change a verdict, with its hash (REQ-17). */
export const LineageItem = z.strictObject({
  kind: none(z.enum(["measure", "judge", "preset", "plugin", "featureGate", "gate", "package"])),
  id: none(Text),
  version: none(Text),
  digest: none(Digest).optional(),
});

/** The reason of a power entry whose margin is refused. Only that entry carries a `refusal`. */
export const REFUSED_MARGIN = "the plan carries no planning statement, and its margin is refused";

/** Why a power entry was not computed. */
export const PowerNotComputed = z.enum([
  "run invalid",
  "no applicable case with a base value",
  "fixed-cases needs at least 2 trials per case and arm",
  REFUSED_MARGIN,
  "the plan carries no planning statement, and none can be computed from it",
]);

const notComputed = {
  computed: none(z.literal(false)),
  measure: none(MeasureId),
  applicableCases: none(z.int().min(0)),
  replicates: none(z.int().min(1)),
  margin: none(z.number().min(0)),
};

/**
 * The power statement of one primary measure (REQ-54). An entry is computed, with its numbers and
 * the assumption behind them, or not computed, with the reason; it never holds a number that is not
 * one. `decidable` says whether the margin is within reach of the minimum detectable effect. Only
 * the plan's entry may switch a plan to estimate-only, before any call; a decision's run-time entry
 * describes the run and never changes its verdict or mode (decision 0017).
 */
export const PowerEntry = z.discriminatedUnion("computed", [
  z.strictObject({
    computed: none(z.literal(true)),
    measure: none(MeasureId),
    applicableCases: none(z.int().min(0)),
    replicates: none(z.int().min(1)),
    margin: none(z.number().min(0)),
    mde: none(z.number().min(0)),
    floor: none(z.number().min(0)),
    sampledCasesFloor: none(z.number().min(0)).optional(),
    assumption: none(Text),
    decidable: none(z.boolean()),
  }),
  z.discriminatedUnion("reason", [
    z.strictObject({
      ...notComputed,
      reason: none(PowerNotComputed.exclude([REFUSED_MARGIN])),
    }),
    z.strictObject({
      ...notComputed,
      reason: none(z.literal(REFUSED_MARGIN)),
      refusal: none(Text),
    }),
  ]),
]);
/** A power entry. */
export type PowerEntry = z.infer<typeof PowerEntry>;

/**
 * The reason of a power entry that was not computed, as a line prints it: the refused reason with
 * its refusal text.
 */
export function notComputedReason(entry: Extract<PowerEntry, { computed: false }>): string {
  return entry.reason === REFUSED_MARGIN ? `${entry.reason}: ${entry.refusal}` : entry.reason;
}

/**
 * One configuration of a plan with its role. A comparison has a `base` and one or more
 * `candidate` arms. An estimate-only run may have a single arm.
 */
export const Arm = z.strictObject({
  name: none(ArmName),
  role: none(z.enum(["base", "candidate", "reference"])),
  identity: none(ConfigurationIdentity),
  configuration: Configuration,
});

/** One planned trial. `family` groups related cases (from the case set) for sampled-cases. */
export const PlannedTrial = z.strictObject({
  id: none(TrialId),
  case: none(CaseId),
  family: none(Text).optional(),
  arm: none(ArmName),
  replicate: none(z.int().min(0)),
  /**
   * The trial's batch (REQ-25). At two or more trials per case and arm, replicate r runs every case
   * under every arm before r + 1. A case's arms run in an order for each replicate: the base and
   * the candidate in the order `candidateRunsFirst` chose for that case and replicate, then any
   * other arm (a reference arm) in the plan's order. With n arms, the trial at position k of that
   * order (k from 0) has batch r × n + k: 2r and 2r + 1 for two arms, 3r to 3r + 2 for three. At
   * one trial per case and arm, it numbers the pairs: every trial of a case carries the case's
   * index, and the plan lists them in the coin's order, which is the run order.
   */
  batch: none(z.int().min(0)),
});

/** A decision record that a plan cites as A/A evidence: its run and its canonical digest. */
export const AaCitation = z.strictObject({
  run: none(RunId),
  digest: none(Digest),
});

/**
 * The run settings that shape a run's schedule: how many trials run at once and the endpoint they
 * call. A/A evidence holds only for the same schedule.
 */
export const Schedule = z.strictObject({
  concurrency: none(z.int().min(1)),
  endpoint: none(Text),
});

/** The trigger that caused a plan (REQ-149). */
export const TriggerKind = z.enum([
  "code",
  "configuration",
  "configuration-outside",
  "new-model",
  "silent-change",
  "case-set",
  "judge",
  "dependency",
  "framework",
  "data",
  "production-signal",
  "manual",
]);

/** The resolved, locked form of a suite for one run (REQ-16). */
export const Plan = z.strictObject({
  schema: none(z.literal("ichnaea.plan/1")),
  suite: none(SuiteId),
  suiteVersion: none(Text),
  suiteDigest: none(Digest),
  caseSet: none(CaseSetId),
  caseSetDigest: none(Digest),
  trigger: none(TriggerKind),
  /**
   * What the plan declares as varied between the arms beyond what its trigger varies by kind
   * (REQ-15), as factor keys: `model.<role>`, `parameter.<name>`, `prompt.<name>` or
   * `factor.<name>`. Any other difference between the arms makes the run INVALID.
   */
  varies: none(z.array(Text)),
  mode: none(z.enum(["decision", "estimate-only"])),
  /** Why the plan runs estimate-only. Empty in decision mode. */
  modeReasons: none(z.array(Text)),
  estimand: none(Estimand),
  alpha: none(z.number().gt(0).lt(0.5)),
  replicates: none(z.int().min(1)),
  arms: z.array(Arm).min(1),
  measures: z.array(LineageItem),
  primary: z.array(PrimaryMeasure),
  secondary: none(z.array(MeasureId)),
  hardGates: none(z.array(GateId)),
  policy: CiPolicy,
  power: z.array(PowerEntry),
  budget: z.strictObject({
    worstCaseCalls: none(z.int().min(0)),
    maxCalls: none(z.int().min(0)),
    /**
     * The suite's bound of calls per trial. In a plan that runs its arms, the calls of every
     * attempt at a trial count against it and against `maxCalls`. An import plan books no worst
     * case, and its calls are another runner's, so neither bound applies to them. A plan without
     * it states no bound per trial, and its calls are not checked.
     */
    callsPerTrial: none(z.int().min(1)).optional(),
    monthlyRemaining: none(z.int().min(0)).optional(),
  }),
  trials: z.array(PlannedTrial),
  /**
   * The run settings that shape the schedule. A decision at one trial per case and arm needs them:
   * its A/A evidence must match them.
   */
  schedule: Schedule.optional(),
  /**
   * The A/A decisions this plan cites, by run and decision digest. At one trial per case and arm, a
   * regression result is validated only with at least two clean A/A decisions of the same suite,
   * model and schedule (VALIDATION.md, "One trial per case").
   */
  aa: z.strictObject({ decisions: z.array(AaCitation) }).optional(),
  seed: Seed,
  createdAt: none(Timestamp),
  ichnaea: none(SemVer),
});
/** A plan. */
export type Plan = z.infer<typeof Plan>;
