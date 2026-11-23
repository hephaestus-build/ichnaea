import type { GateResult as GateResultRecord } from "../contracts/records/decision.ts";
import type { MeasureValue as MeasureValueRecord } from "../contracts/records/measure.ts";
import type { Plan as PlanRecord } from "../contracts/records/plan.ts";
import type { Run as RunRecord } from "../contracts/records/run.ts";
import type { TrialResult } from "../contracts/records/worker.ts";
import type { Trial as TrialRecord } from "../contracts/records/trial.ts";

/** The primary records of one run, written together. */
export interface RunRecords {
  /** The plan that the run carries out. */
  readonly plan: PlanRecord;
  /** The run record with its ledger. */
  readonly run: RunRecord;
  /** The run's trial records, one for each trial ID. */
  readonly trials: readonly TrialRecord[];
  /** The measure values, one for each measure and trial. */
  readonly values: readonly MeasureValueRecord[];
  /** The hard gates' results, one for each gate. */
  readonly gates: readonly GateResultRecord[];
  /** The raw worker results, including earlier attempts, in receipt order. */
  readonly workerResults?: readonly TrialResult[];
}

/** Duplicate keys in a list of records, each named once. */
function duplicates<T>(records: readonly T[], key: (r: T) => string): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const r of records) {
    const k = key(r);
    if (seen.has(k)) repeated.add(k);
    seen.add(k);
  }
  return [...repeated];
}

/**
 * The rules every set of run records keeps: one record per trial, one value per measure and trial,
 * one result per gate. A second record would silently replace the first in any lookup, so it could
 * hide a regression. Returns one message per broken rule.
 */
export function recordProblems(records: Omit<RunRecords, "plan" | "run">): string[] {
  const problems: string[] = [];
  const trials = duplicates(records.trials, (t) => t.id);
  if (trials.length > 0) problems.push(`duplicate trial ID(s): ${trials.join(", ")}`);
  const values = duplicates(records.values, (v) => `${v.measure} on ${v.trial}`);
  if (values.length > 0) problems.push(`duplicate measure value(s): ${values.join(", ")}`);
  const gates = duplicates(records.gates, (g) => g.gate);
  if (gates.length > 0) problems.push(`duplicate gate result(s): ${gates.join(", ")}`);
  return problems;
}
