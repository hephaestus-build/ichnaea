import * as z from "zod";

import { none } from "../data-class.ts";
import { FindingId, MeasureId, MonitorId, Timestamp, TrialId } from "../primitives.ts";

/**
 * An online or scheduled check (REQ-60). An alert without an owner and an action is
 * a dashboard series, so both are required.
 */
export const Monitor = z.object({
  schema: none(z.literal("ichnaea.monitor/1")),
  id: none(MonitorId),
  measure: none(MeasureId),
  strata: none(z.array(z.string().min(1))).optional(),
  sampling: none(z.enum(["census", "random", "triage"])),
  statistic: none(
    z.enum(["bernoulli-cusum", "poisson-cusum", "confidence-sequence", "age-threshold"]),
  ),
  parameters: none(z.record(z.string(), z.number())),
  reference: none(z.number()),
  falseAlarmsPerYear: none(z.number().gt(0)),
  practicalMargin: none(z.number().min(0)),
  owner: none(z.string().min(1)),
  action: none(z.string().min(1)),
  severity: none(z.enum(["info", "warning", "critical"])),
});
/** A monitor. */
export type Monitor = z.infer<typeof Monitor>;

/** A confirmed failure with pointers to its trial records (REQ-70, REQ-71). */
export const Finding = z.object({
  schema: none(z.literal("ichnaea.finding/1")),
  id: none(FindingId),
  source: none(z.enum(["monitor", "canary", "check", "triage", "manual"])),
  trials: none(z.array(TrialId)),
  pointers: none(z.array(z.string().min(1))),
  failureClass: none(z.string().min(1)),
  confirmedAt: none(Timestamp).optional(),
  confirmerRole: none(z.string().min(1)).optional(),
  promotion: none(z.enum(["none", "synthetic", "consented", "rejected"])),
  linkedCase: none(z.string().min(1)).optional(),
  action: none(z.string().min(1)).optional(),
});
/** A finding. */
export type Finding = z.infer<typeof Finding>;
