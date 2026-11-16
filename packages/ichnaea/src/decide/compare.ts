import type { Decision } from "../contracts/index.ts";
import type { RunRecords } from "../core/records.ts";
import type { SuitePlan } from "../core/suite.ts";

import { type AaEvidence, decide } from "./decide.ts";

/**
 * Decides a run: the verdict of the candidate against the base, from the plan and the run's
 * records. It is synchronous and pure: the same records and `decidedAt` give the same decision,
 * byte for byte, and it does no I/O. Records that do not belong to the plan, arms that differ
 * beyond the plan's intended changes, and other broken records make the run INVALID. `aa` gives
 * each noise check (A/A decision) that the plan cites, with its plan and run, as one trial per case
 * needs them.
 */
export function compare(
  plan: SuitePlan,
  records: RunRecords,
  options: { readonly decidedAt: string; readonly aa?: readonly AaEvidence[] },
): Decision {
  return decide({
    plan: plan.record,
    run: records.run,
    trials: records.trials,
    values: records.values,
    gates: records.gates,
    decidedAt: options.decidedAt,
    ichnaea: plan.record.ichnaea,
    ...(options.aa === undefined ? {} : { aa: options.aa }),
  });
}
