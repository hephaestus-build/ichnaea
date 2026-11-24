import { canonicalize } from "../contracts/canonical.ts";
import type { Decision } from "../contracts/records/decision.ts";
import type { Plan } from "../contracts/records/plan.ts";
import type { Run } from "../contracts/records/run.ts";
import type { RunRecords } from "../contracts/run-records.ts";
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
export function recompute(records: DecisionRecords): RecomputeResult {
  const again = calculateDecision(records, records.decision.ichnaea);
  const stored = records.decision as unknown as Record<string, unknown>;
  const fresh = again as unknown as Record<string, unknown>;
  const differences = [...new Set([...Object.keys(stored), ...Object.keys(fresh)])].filter(
    (k) => canonicalize(stored[k] ?? null) !== canonicalize(fresh[k] ?? null),
  );
  return { matches: differences.length === 0, differences };
}

/** Stored decision inputs, including any referenced base-against-base decisions. */
export interface DecisionRecords extends RunRecords {
  /** The decision written by the original engine. */
  readonly decision: Decision;
  /** Referenced base-against-base evidence, in the order the plan declares. */
  readonly aa?: readonly { decision: Decision; plan: Plan; run: Run }[];
}

/** Replay with the chosen engine and the original decision time. */
export function calculateDecision(records: DecisionRecords, ichnaea: string): Decision {
  return decide({
    ...records,
    decidedAt: records.decision.decidedAt,
    ichnaea,
  });
}
