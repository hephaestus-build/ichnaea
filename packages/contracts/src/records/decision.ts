import * as z from "zod";

import { content, none } from "../data-class.ts";
import {
  CaseId,
  ConfigurationIdentity,
  Digest,
  GateId,
  MeasureId,
  PlanDigest,
  Real,
  RunId,
  SemVer,
  Timestamp,
} from "../primitives.ts";
import { PowerEntry } from "./plan.ts";
import { Estimand } from "./suite.ts";

/** A run verdict (REQ-53). */
export const Verdict = z.enum(["PASS", "REGRESSION", "INCONCLUSIVE", "INVALID"]);
/** A run verdict. */
export type Verdict = z.infer<typeof Verdict>;

/** A verdict for one primary measure. */
export const MeasureVerdict = z.enum([
  "NON-INFERIOR",
  "REGRESSION",
  "INCONCLUSIVE",
  "ESTIMATE-ONLY",
]);

/** Counts behind a rate, with not-applicable and missing kept apart (REQ-30). */
export const Availability = z.object({
  planned: none(z.int().min(0)),
  available: none(z.int().min(0)),
  notApplicable: none(z.int().min(0)),
  missing: none(z.int().min(0)),
});

/** An estimate with its interval and method. */
export const Estimate = z.object({
  estimate: none(Real),
  lower: none(Real),
  upper: none(Real),
  level: none(z.number().gt(0).lt(1)),
  sided: none(z.enum(["two", "lower", "upper"])),
  method: none(z.string().min(1)),
});

/** A case whose binary outcome changed between arms (REQ-52). */
export const Flip = z.object({
  case: none(CaseId),
  direction: none(z.enum(["negative", "positive"])),
  base: none(z.number().min(0).max(1)),
  candidate: none(z.number().min(0).max(1)),
});

/** The result for one primary measure. */
export const MeasureResult = z.object({
  measure: none(MeasureId),
  version: none(SemVer),
  estimand: none(Estimand),
  base: z.object({ rate: Estimate, availability: Availability }),
  candidate: z.object({ rate: Estimate, availability: Availability }),
  difference: Estimate,
  margin: none(z.number().min(0)),
  safetyMargin: none(z.number().min(0)),
  nonInferiorityP: none(Real).optional(),
  regressionP: none(Real).optional(),
  regressionPAdjusted: none(Real).optional(),
  verdict: none(MeasureVerdict),
  coverage: none(z.number().min(0).max(1)),
  flips: z.array(Flip),
  notes: none(z.array(z.string().min(1))),
});

/** The result of one hard gate. */
export const GateResult = z.object({
  gate: none(GateId),
  passed: none(z.boolean()),
  failures: none(z.int().min(0)),
  detail: content(z.string()).optional(),
});

/** The comparison of missing trials between arms (REQ-56). */
export const Missingness = z.object({
  base: none(z.int().min(0)),
  candidate: none(z.int().min(0)),
  differs: none(z.boolean()),
  sensitivity: none(z.enum(["unchanged", "changes-verdict", "not-needed"])),
});

/** The verdict of one run with estimates, intervals, flips and lineage (REQ-49 to REQ-56). */
export const Decision = z.object({
  schema: none(z.literal("ichnaea.decision/1")),
  mode: none(z.enum(["decision", "estimate-only"])),
  verdict: none(Verdict.nullable()),
  reason: none(z.string().min(1)),
  plan: none(PlanDigest),
  run: none(RunId),
  runDigest: none(Digest),
  base: none(ConfigurationIdentity),
  candidate: none(ConfigurationIdentity),
  differingFactors: none(z.array(z.string().min(1))),
  alpha: none(z.number().gt(0).lt(0.5)),
  measures: z.array(MeasureResult),
  gates: z.array(GateResult),
  power: z.array(PowerEntry),
  missingness: Missingness,
  invalidReasons: none(z.array(z.string().min(1))),
  limitations: none(z.array(z.string().min(1))),
  seed: z.object({ algorithm: none(z.string().min(1)), value: none(z.int().min(0)) }),
  decidedAt: none(Timestamp),
  ichnaea: none(SemVer),
  dataClass: none(z.enum(["none", "pseudonymous", "personal", "special"])),
});
/** A decision. */
export type Decision = z.infer<typeof Decision>;
