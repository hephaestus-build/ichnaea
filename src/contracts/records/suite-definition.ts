import * as z from "zod";

import { Case, CaseProvenance, Pool } from "./case.ts";
import { Configuration } from "./configuration.ts";
import { AnalysisPrimary, RegisteredTrialReduction } from "./analysis-plan.ts";
import { MustNever } from "./must-never.ts";
import { CiPolicy, Estimand } from "./suite.ts";
import { GateId, Json, MeasureId, SuiteId, Text } from "../primitives.ts";

const ModelSettings = z.strictObject({
  model: Text,
  provider: Text.optional(),
  prompt: Text.optional(),
  parameters: z.record(Text, Json).optional(),
});

export const ArmDefinition = z.union([Configuration, Text, ModelSettings]);
export type ArmDefinition = z.input<typeof ArmDefinition>;

/** The suite and the paths its configuration resolves. */
export const SuiteDefinition = z.strictObject({
  id: SuiteId,
  version: Text.optional(),
  cases: Text,
  caseSet: Text.optional(),
  caseDefaults: Case.pick({ unit: true, dataClass: true })
    .extend({
      provenance: CaseProvenance,
      pool: Pool,
    })
    .partial()
    .optional(),
  arms: z.strictObject({ base: ArmDefinition, candidate: ArmDefinition.optional() }),
  objective: Text,
  construct: Text,
  decision: Text,
  scope: Text,
  nonCoverage: z.union([Text, z.array(Text).min(1)]),
  estimand: Estimand.optional(),
  alpha: z.number().gt(0).lt(0.5).optional(),
  blocks: z.int().min(1).optional(),
  replicates: z.int().min(1).optional(),
  primary: z.array(z.union([MeasureId, AnalysisPrimary])).optional(),
  secondary: z.array(MeasureId).optional(),
  hardGates: z.array(GateId).optional(),
  trialReduction: RegisteredTrialReduction.optional(),
  mustNever: z.array(MustNever).min(1).optional(),
  maxCalls: z.int().min(0).optional(),
  policy: CiPolicy.optional(),
});
/** The authored suite configuration. */
export type SuiteDefinition = z.input<typeof SuiteDefinition>;

/** Defines the case source, measures and arms for a suite. */
export function defineSuite(suite: SuiteDefinition): SuiteDefinition {
  return SuiteDefinition.parse(suite);
}
