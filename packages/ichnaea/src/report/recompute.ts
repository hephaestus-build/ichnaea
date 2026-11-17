import { canonicalize } from "../contracts/canonical.ts";
import type { Decision, GateResult } from "../contracts/records/decision.ts";
import type { MeasureValue } from "../contracts/records/measure.ts";
import type { Plan } from "../contracts/records/plan.ts";
import type { Run } from "../contracts/records/run.ts";
import type { Trial } from "../contracts/records/trial.ts";
import { decide } from "../decide/decide.ts";

/** The result of recomputing a stored decision. */
export interface RecomputeResult {
  /** Whether the recomputed decision equals the stored one. */
  readonly matches: boolean;
  /**
   * The top-level members of the decision whose recomputed value differs; empty when it matches.
   */
  readonly differences: readonly string[];
}

/**
 * Recomputes a decision from the stored primary records and compares it with the stored decision
 * (REQ-83). Any difference (a changed record, a different statistics version) fails.
 */
export function recompute(records: {
  readonly plan: Plan;
  readonly run: Run;
  readonly trials: readonly Trial[];
  readonly values: readonly MeasureValue[];
  readonly gates: readonly GateResult[];
  readonly decision: Decision;
  /** The A/A evidence the plan cites, as `decide` took it. */
  readonly aa?: readonly { decision: Decision; plan: Plan; run: Run }[];
}): RecomputeResult {
  const again = decide({
    ...records,
    decidedAt: records.decision.decidedAt,
    ichnaea: records.decision.ichnaea,
  });
  const stored = records.decision as unknown as Record<string, unknown>;
  const fresh = again as unknown as Record<string, unknown>;
  const differences = [...new Set([...Object.keys(stored), ...Object.keys(fresh)])].filter(
    (k) => canonicalize(stored[k] ?? null) !== canonicalize(fresh[k] ?? null),
  );
  return { matches: differences.length === 0, differences };
}
