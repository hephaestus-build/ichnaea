import {
  canonicalize,
  type Decision,
  type GateResult,
  type MeasureValue,
  type Plan,
  type Run,
  type Trial,
} from "@hephaestus-build/ichnaea-contracts";
import { decide } from "@hephaestus-build/ichnaea-decide";

/** The result of recomputing a stored decision. */
export interface RecomputeResult {
  readonly matches: boolean;
  readonly differences: readonly string[];
}

/**
 * Recomputes a decision from the stored primary records and compares it with the stored decision
 * (REQ-83). Any difference (a changed record, a different statistics version) fails.
 */
export async function recompute(records: {
  readonly plan: Plan;
  readonly run: Run;
  readonly trials: readonly Trial[];
  readonly values: readonly MeasureValue[];
  readonly gates: readonly GateResult[];
  readonly decision: Decision;
}): Promise<RecomputeResult> {
  const again = await decide({
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
