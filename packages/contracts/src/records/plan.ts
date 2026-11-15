import * as z from "zod";

import { none } from "../data-class.ts";
import {
  CaseId,
  CaseSetId,
  ConfigurationIdentity,
  Digest,
  MeasureId,
  Real,
  SemVer,
  SuiteId,
  Timestamp,
  TrialId,
} from "../primitives.ts";
import { Estimand } from "./suite.ts";

/** A versioned part that can change a verdict, with its hash (REQ-17). */
export const LineageItem = z.object({
  kind: none(z.enum(["measure", "judge", "preset", "plugin", "featureGate", "gate", "package"])),
  id: none(z.string().min(1)),
  version: none(z.string().min(1)),
  digest: none(Digest).optional(),
});

/** The power statement of one primary measure (REQ-54). */
export const PowerEntry = z.object({
  measure: none(MeasureId),
  applicableCases: none(z.int().min(0)),
  replicates: none(z.int().min(1)),
  margin: none(z.number().min(0)),
  mde: none(Real),
  floor: none(Real),
  sampledCasesFloor: none(Real).optional(),
  assumption: none(z.string().min(1)),
  decidable: none(z.boolean()),
});

/** One compared configuration of a plan. */
export const Arm = z.object({
  name: none(z.enum(["base", "candidate"])),
  configuration: none(ConfigurationIdentity),
});

/** One planned trial. */
export const PlannedTrial = z.object({
  id: none(TrialId),
  case: none(CaseId),
  arm: none(z.enum(["base", "candidate"])),
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
export const Plan = z.object({
  schema: none(z.literal("ichnaea.plan/1")),
  suite: none(SuiteId),
  suiteVersion: none(z.string().min(1)),
  suiteDigest: none(Digest),
  caseSet: none(CaseSetId),
  caseSetDigest: none(Digest),
  trigger: none(TriggerKind),
  mode: none(z.enum(["decision", "estimate-only"])),
  estimand: none(Estimand),
  alpha: none(z.number().gt(0).lt(0.5)),
  replicates: none(z.int().min(1)),
  arms: z.array(Arm).min(1),
  measures: z.array(LineageItem),
  power: z.array(PowerEntry),
  budget: z.object({
    worstCaseCalls: none(z.int().min(0)),
    maxCalls: none(z.int().min(0)),
    monthlyRemaining: none(z.int().min(0)).optional(),
  }),
  trials: z.array(PlannedTrial),
  seed: z.object({ algorithm: none(z.string().min(1)), value: none(z.int().min(0)) }),
  createdAt: none(Timestamp),
  ichnaea: none(SemVer),
});
/** A plan. */
export type Plan = z.infer<typeof Plan>;
