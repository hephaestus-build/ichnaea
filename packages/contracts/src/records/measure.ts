import * as z from "zod";

import { content, none } from "../data-class.ts";
import {
  Digest,
  JudgeId,
  MeasureId,
  Real,
  SemVer,
  Timestamp,
  TrialId,
  Unit,
} from "../primitives.ts";

/** The definition of a measure (REQ-29). A measure without a card does not register. */
export const MeasureCard = z.object({
  schema: none(z.literal("ichnaea.measureCard/1")),
  id: none(MeasureId),
  version: none(SemVer),
  construct: none(z.string().min(1)),
  operationalDefinition: none(z.string().min(1)),
  valueType: none(z.enum(["binary", "score"])),
  unit: none(z.string().min(1)),
  direction: none(z.enum(["higher", "lower"])),
  scale: z.object({ min: none(z.number()), max: none(z.number()) }).optional(),
  justification: none(z.string().min(1)),
  errorModel: none(z.string().min(1)),
  applicability: none(z.string().min(1)),
  tier: none(z.enum(["primary", "secondary", "diagnostic"])),
  unitOfEvaluation: none(Unit),
  establishes: none(z.string().min(1)),
  computedBy: none(z.enum(["ichnaea", "application", "judge"])),
  judge: none(JudgeId).optional(),
  validation: z
    .object({
      tester: z
        .object({
          status: none(z.enum(["passed", "failed"])),
          digest: none(Digest),
          ranAt: none(Timestamp),
        })
        .optional(),
      calibration: none(Digest).optional(),
    })
    .optional(),
});
/** A measure card. */
export type MeasureCard = z.infer<typeof MeasureCard>;

/**
 * One measure value on one trial. `applicable: false` is not applicable, never zero or missing
 * (REQ-30). An application-computed value names its source (REQ-31).
 */
export const MeasureValue = z.object({
  schema: none(z.literal("ichnaea.measureValue/1")),
  trial: none(TrialId),
  measure: none(MeasureId),
  version: none(SemVer),
  applicable: none(z.boolean()),
  value: none(Real).optional(),
  source: none(z.enum(["ichnaea", "application", "judge", "human"])),
  detail: content(z.string()).optional(),
  dataClass: none(z.enum(["none", "pseudonymous", "personal", "special"])),
});
/** A measure value. */
export type MeasureValue = z.infer<typeof MeasureValue>;
