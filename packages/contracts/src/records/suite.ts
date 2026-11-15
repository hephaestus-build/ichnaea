import * as z from "zod";

import { none } from "../data-class.ts";
import {
  CalendarDate,
  CaseSetId,
  Digest,
  GateId,
  MeasureId,
  Probability,
  SuiteId,
  Text,
} from "../primitives.ts";

/** The question an estimate answers (REQ-49). */
export const Estimand = z.enum(["fixed-cases", "sampled-cases"]);
/** An estimand. */
export type Estimand = z.infer<typeof Estimand>;

/** What a CI policy does with a verdict that is not PASS (REQ-26, REQ-27). */
export const PolicyAction = z.enum(["block", "report"]);

/** The CI policy of a suite. INCONCLUSIVE and estimate-only must have a stated action (REQ-27). */
export const CiPolicy = z.object({
  onRegression: none(PolicyAction),
  onInconclusive: none(PolicyAction),
  onEstimateOnly: none(PolicyAction),
  onInvalid: none(PolicyAction),
});

/** The run budget (REQ-21). */
export const Budget = z.object({
  maxCalls: none(z.int().min(0)),
  callsPerTrial: none(z.int().min(1)),
  maxCost: none(z.number().min(0)).optional(),
  costUnit: none(Text).optional(),
});

/** A primary measure with its margin and optional safety margin. */
export const PrimaryMeasure = z.object({
  measure: none(MeasureId),
  margin: none(z.number().min(0)),
  marginReason: none(Text),
  safetyMargin: none(z.number().min(0)).optional(),
  coverageFloor: none(Probability).optional(),
});

/** A reference to the case set a suite evaluates. */
export const CaseSetRef = z.object({
  id: none(CaseSetId),
  path: none(Text),
  digest: none(Digest).optional(),
});

/** A suite: what an application declares it evaluates (REQ-16, REQ-115). It names no system. */
export const Suite = z.object({
  schema: none(z.literal("ichnaea.suite/1")),
  id: none(SuiteId),
  version: none(Text),
  objective: none(Text),
  construct: none(Text),
  decision: none(Text),
  scope: none(Text),
  nonCoverage: none(Text),
  estimand: none(Estimand),
  caseSet: CaseSetRef,
  pools: none(
    z.array(z.enum(["development", "validation", "sealed", "promoted"])).min(1),
  ).optional(),
  replicates: none(z.int().min(1)),
  alpha: none(z.number().gt(0).lt(0.5)).optional(),
  primary: z.array(PrimaryMeasure),
  secondary: none(z.array(MeasureId)).optional(),
  hardGates: none(z.array(GateId)).optional(),
  budget: Budget,
  policy: CiPolicy,
  threats: none(z.array(z.string().min(1))).optional(),
  measureReviewDate: none(CalendarDate),
  paths: none(z.array(z.string().min(1))).optional(),
});
/** A suite. */
export type Suite = z.infer<typeof Suite>;
