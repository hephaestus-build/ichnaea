import type { Decision } from "../contracts/records/decision.ts";
import type { Plan } from "../contracts/records/plan.ts";
import type { RunRecords } from "../contracts/run-records.ts";

import { type AaEvidence, decide } from "./decide.ts";

/**
 * Decides a run: the verdict of the candidate against the base, from the plan and the run's
 * records. It is synchronous and pure: the same records and `decidedAt` give the same decision,
 * byte for byte, and it reads no clock, file or network. The decision records the plan's Ichnaea
 * version. Records that do not belong to the plan, arms that differ beyond what the plan varies,
 * and other broken records make the run INVALID. `aa` gives each noise check (A/A decision) that
 * the plan cites, with its plan and run, as one trial per case needs them.
 */
export function compare(
  plan: Plan,
  records: Omit<RunRecords, "plan">,
  options: { readonly decidedAt: string; readonly aa?: readonly AaEvidence[] },
): Decision {
  return decide({
    plan,
    run: records.run,
    trials: records.trials,
    values: records.values,
    gates: records.gates,
    decidedAt: options.decidedAt,
    ichnaea: plan.ichnaea,
    ...(options.aa === undefined ? {} : { aa: options.aa }),
  });
}
