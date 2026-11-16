import * as z from "zod";

import { none, personal, quasi } from "../data-class.ts";
import {
  CaseId,
  FindingId,
  MeasureId,
  MonitorId,
  Text,
  Timestamp,
  TrialId,
} from "../primitives.ts";

/**
 * An online or scheduled check (REQ-60). An alert without an owner and an action is a dashboard
 * series, so both are required. The owner may be a person, so it is classed personal.
 */
export const Monitor = z.strictObject({
  schema: none(z.literal("ichnaea.monitor/1")),
  id: none(MonitorId),
  measure: none(MeasureId),
  strata: none(z.array(Text)).optional(),
  sampling: none(z.enum(["census", "random", "triage"])),
  statistic: none(
    z.enum(["bernoulli-cusum", "poisson-cusum", "confidence-sequence", "age-threshold"]),
  ),
  parameters: none(z.record(z.string(), z.number())),
  reference: none(z.number()),
  falseAlarmsPerYear: none(z.number().gt(0)),
  practicalMargin: none(z.number().min(0)),
  owner: personal(Text),
  action: none(Text),
  severity: none(z.enum(["info", "warning", "critical"])),
});
/** A monitor. */
export type Monitor = z.infer<typeof Monitor>;

/** A confirmed failure with pointers to its trial records (REQ-70, REQ-71). */
export const Finding = z.strictObject({
  schema: none(z.literal("ichnaea.finding/1")),
  id: none(FindingId),
  source: none(z.enum(["monitor", "canary", "check", "triage", "manual"])),
  trials: none(z.array(TrialId)),
  pointers: quasi(z.array(Text)),
  failureClass: none(Text),
  confirmedAt: none(Timestamp).optional(),
  confirmerRole: none(Text).optional(),
  promotion: none(z.enum(["none", "synthetic", "consented", "rejected"])),
  linkedCase: none(CaseId).optional(),
  action: none(Text).optional(),
});
/** A finding. */
export type Finding = z.infer<typeof Finding>;
