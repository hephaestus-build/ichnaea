import {
  type Case,
  canonicalize,
  digest,
  type MeasureValue,
  type Trial,
} from "../contracts/index.ts";

import type { MeasureDefinition } from "./plugin.ts";

/** Outcomes that a measure scores (REQ-20). */
const SCORED = new Set(["completed", "abstained"]);
/** Outcomes that count as a failure on a measure. */
const FAILED = new Set(["system_failure", "budget_exceeded"]);

/**
 * Scores trials with the measures Ichnaea computes. A measure that does not apply to a case
 * gives an explicit not-applicable value, never a zero (REQ-30). A system failure or a budget
 * overrun scores as a failure; infrastructure failures, trials not run and invalid configurations
 * give no value, so they count as missing. A capture failure is never `completed`: import makes a
 * completed record without captured output an infrastructure failure first (`NOT_CAPTURED`), so a
 * measure only ever scores output that was captured.
 */
export function scoreTrials(
  measures: readonly MeasureDefinition[],
  trials: readonly Trial[],
  cases: ReadonlyMap<string, Case>,
): MeasureValue[] {
  const values: MeasureValue[] = [];
  for (const measure of measures) {
    if (measure.card.computedBy !== "ichnaea" || !measure.score) continue;
    for (const trial of trials) {
      const c = trial.case === null ? undefined : cases.get(trial.case);
      if (!c) continue;
      const base = {
        schema: "ichnaea.measureValue/1" as const,
        trial: trial.id,
        measure: measure.card.id,
        version: measure.card.version,
        source: "ichnaea" as const,
        dataClass: trial.dataClass,
      };
      if (measure.appliesTo && !measure.appliesTo(c)) {
        values.push({ ...base, applicable: false } as MeasureValue);
        continue;
      }
      if (FAILED.has(trial.outcome)) {
        const value = failureValue(measure, c);
        if (value) values.push({ ...base, applicable: true, value } as MeasureValue);
        continue;
      }
      if (!SCORED.has(trial.outcome)) continue;
      const value = measure.score(trial, c);
      if (value !== undefined) values.push({ ...base, applicable: true, value } as MeasureValue);
    }
  }
  return values;
}

function failureValue(measure: MeasureDefinition, c: Case): MeasureValue["value"] {
  switch (measure.card.valueType) {
    case "binary":
      return { type: "binary", pass: false };
    case "proportion":
      return { type: "proportion", successes: 0, trials: measure.items?.(c) ?? 1 };
    default:
      // A failed trial has no score on a continuous or ordinal scale: it stays missing.
      return undefined;
  }
}

/** The result of running a measure's known-good and known-bad examples. */
export interface TesterResult {
  /**
   * `passed` when every example gives its expected value and the measure has both kinds of example.
   */
  readonly status: "passed" | "failed";
  /**
   * One message for each example that failed, or for missing examples; empty when the test passed.
   */
  readonly failures: readonly string[];
  /** The digest of the measure's card and examples that were tested. */
  readonly digest: string;
}

/**
 * Runs a measure against its examples (REQ-33, REQ-121). It fails when a known-good example does
 * not give its expected value, when a known-bad example passes as good, or when the measure has no
 * good and no bad example.
 */
export async function testMeasure(measure: MeasureDefinition): Promise<TesterResult> {
  const failures: string[] = [];
  const examples = measure.examples;
  if (!examples || examples.good.length === 0 || examples.bad.length === 0) {
    failures.push(`${measure.card.id}: needs at least one known-good and one known-bad example`);
  }
  for (const [kind, list] of [
    ["good", examples?.good ?? []],
    ["bad", examples?.bad ?? []],
  ] as const) {
    for (const example of list) {
      const applies = !measure.appliesTo || measure.appliesTo(example.case);
      const actual = !applies
        ? "not-applicable"
        : measure.score
          ? (measure.score(example.trial, example.case) ?? "missing")
          : "missing";
      if (canonicalize(actual) !== canonicalize(example.expected)) {
        failures.push(
          `${measure.card.id}: ${kind} example '${example.name}' gave ${canonicalize(actual)}, expected ${canonicalize(example.expected)}`,
        );
      }
    }
  }
  const hash = await digest({ card: measure.card, examples: examples ?? null });
  return { status: failures.length === 0 ? "passed" : "failed", failures, digest: hash };
}
