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
  Real,
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

/** The power statement of one primary measure (REQ-54). */
export const PowerEntry = z.strictObject({
  measure: none(MeasureId),
  applicableCases: none(z.int().min(0)),
  replicates: none(z.int().min(1)),
  margin: none(z.number().min(0)),
  mde: none(Real),
  floor: none(Real),
  sampledCasesFloor: none(Real).optional(),
  assumption: none(Text),
  decidable: none(z.boolean()),
});

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
  batch: none(z.int().min(0)),
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
    monthlyRemaining: none(z.int().min(0)).optional(),
  }),
  trials: z.array(PlannedTrial),
  seed: Seed,
  createdAt: none(Timestamp),
  ichnaea: none(SemVer),
});
/** A plan. */
export type Plan = z.infer<typeof Plan>;
