import type { Decision, Real, Run } from "@hephaestus-build/ichnaea-contracts";

/** A number as reports show it: a percentage with one decimal, or a dash when undefined. */
export function percent(value: Real | number): string {
  if (typeof value !== "number")
    return value.nonFinite === "nan" ? "–" : value.nonFinite === "inf" ? "+∞" : "−∞";
  const rounded = Math.round(value * 1000) / 10;
  return `${Object.is(rounded, -0) ? "0.0" : rounded.toFixed(1)}%`;
}

/** A difference in percentage points with its sign. */
export function points(value: Real | number): string {
  if (typeof value !== "number") return percent(value);
  const rounded = Math.round(value * 1000) / 10;
  const magnitude = Math.abs(rounded).toFixed(1);
  // A true minus sign, as in the margin column.
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${magnitude} pts`;
}

/** One row of the per-measure table. */
export interface MeasureRow {
  readonly measure: string;
  readonly tier: string;
  readonly verdict: string;
  readonly arms: ReadonlyArray<{
    readonly arm: string;
    readonly rate: string;
    readonly interval: string;
    readonly n: string;
    readonly missing: number;
  }>;
  readonly difference?: {
    readonly estimate: string;
    readonly bound: string;
    readonly margin: string;
    readonly method: string;
    readonly negativeFlips: number;
    readonly positiveFlips: number;
    /** The numbers behind the difference axis, when the bound is finite. */
    readonly axis?: { readonly estimate: number; readonly lower: number; readonly margin: number };
  };
  readonly notes: readonly string[];
}

/** The view model of a decision. Every output renders from it, so they show the same numbers. */
export interface DecisionView {
  readonly title: string;
  readonly verdict: string;
  /** What the verdict is about, shown next to it: "on these 60 cases, beyond run-to-run noise". */
  readonly claim: string;
  readonly reason: string;
  /** How the verdict was reached: estimand, bounds and adjustments. */
  readonly method: string;
  readonly measures: readonly MeasureRow[];
  readonly gates: ReadonlyArray<{ readonly gate: string; readonly result: string }>;
  readonly flips: ReadonlyArray<{
    readonly measure: string;
    readonly case: string;
    readonly direction: string;
    readonly base: string;
    readonly candidate: string;
  }>;
  readonly power: ReadonlyArray<{
    readonly measure: string;
    readonly cases: number;
    readonly replicates: number;
    readonly floor: string;
    readonly mde: string;
    readonly margin: string;
    readonly decidable: string;
    readonly assumption: string;
  }>;
  readonly missingness: string;
  readonly differingFactors: readonly string[];
  readonly limitations: readonly string[];
  readonly lineage: ReadonlyArray<readonly [string, string]>;
}

/**
 * Builds the view model from a decision record alone. It computes nothing new: every number comes
 * from the record (REQ-82, REQ-128).
 */
export function decisionView(
  decision: Decision,
  suite: string,
  lineage: Run["lineage"] = [],
): DecisionView {
  const verdict = decision.verdict ?? "ESTIMATE-ONLY";
  const level = Math.round((1 - decision.alpha) * 100);
  return {
    title: `Ichnaea decision: ${suite}`,
    verdict,
    claim: decision.scope,
    reason: decision.reason,
    method:
      decision.mode === "estimate-only"
        ? `Estimate-only (${decision.measures[0]?.estimand ?? "fixed-cases"}): no inferential verdict. Rates carry ${95}% Wilson intervals; differences are descriptive.`
        : `Estimand ${decision.measures[0]?.estimand ?? "fixed-cases"}; one-sided ${level}% lower bounds for differences (candidate minus base); intersection-union over primary measures; Holm across regression tests.`,
    measures: decision.measures.map((m) => {
      const comparison = m.comparisons[0];
      return {
        measure: m.measure,
        tier: m.tier,
        verdict: m.verdict,
        arms: m.arms.map((a) => ({
          arm: a.arm,
          rate: percent(a.rate.estimate),
          interval: `${percent(a.rate.lower)} to ${percent(a.rate.upper)}`,
          n: `${a.availability.available} of ${a.availability.planned}`,
          missing: a.availability.missing,
        })),
        ...(comparison
          ? {
              difference: {
                estimate: points(comparison.difference.estimate),
                bound: comparison.difference.method.startsWith("descriptive")
                  ? "no interval (estimate-only)"
                  : `≥ ${points(comparison.difference.lower)}`,
                // A secondary measure has no margin: it is descriptive.
                margin:
                  m.tier === "secondary"
                    ? "–"
                    : `−${(comparison.margin * 100).toFixed(1)} pts${comparison.safetyMargin > 0 ? ` (safety ${(comparison.safetyMargin * 100).toFixed(1)})` : ""}`,
                method: comparison.difference.method,
                negativeFlips: comparison.flips.filter((f) => f.direction === "negative").length,
                positiveFlips: comparison.flips.filter((f) => f.direction === "positive").length,
                ...(typeof comparison.difference.estimate === "number" &&
                typeof comparison.difference.lower === "number"
                  ? {
                      axis: {
                        estimate: comparison.difference.estimate,
                        lower: comparison.difference.lower,
                        margin: comparison.margin,
                      },
                    }
                  : {}),
              },
            }
          : {}),
        notes: m.notes,
      };
    }),
    gates: decision.gates.map((g) => ({
      gate: g.gate,
      result: g.passed ? "passed" : `failed (${g.failures})`,
    })),
    flips: decision.measures.flatMap((m) =>
      (m.comparisons[0]?.flips ?? []).map((f) => ({
        measure: m.measure,
        case: f.case,
        direction: f.direction,
        base: percent(f.base),
        candidate: percent(f.candidate),
      })),
    ),
    power: decision.power.map((p) => ({
      measure: p.measure,
      cases: p.applicableCases,
      replicates: p.replicates,
      floor: points(p.floor).replace("+", ""),
      mde: points(p.mde).replace("+", ""),
      margin: `${(p.margin * 100).toFixed(1)} pts`,
      decidable: p.decidable ? "yes" : "no",
      assumption: p.assumption,
    })),
    missingness: `${decision.missingness.byArm.map((a) => `${a.arm}: ${a.missing} of ${a.planned} missing`).join("; ")}. ${
      decision.missingness.sensitivity === "not-needed"
        ? "No infrastructure failures, so no sensitivity analysis."
        : decision.missingness.sensitivity === "unchanged"
          ? "Counting infrastructure failures as failures does not change any verdict."
          : "Counting infrastructure failures as failures changes a verdict."
    }`,
    differingFactors: decision.differingFactors,
    limitations: decision.limitations,
    lineage: [
      ["Run", decision.run],
      ["Plan", decision.plan],
      ["Run record", decision.runDigest],
      ...decision.arms.map((a): readonly [string, string] => [
        `Arm ${a.name} (${a.role})`,
        a.identity,
      ]),
      ...decision.measures.map((m): readonly [string, string] => [
        `Measure ${m.measure}`,
        m.version,
      ]),
      ...lineage
        .filter((l) => l.kind !== "measure")
        .map((l): readonly [string, string] => [
          `${l.kind[0]?.toUpperCase() ?? ""}${l.kind.slice(1)} ${l.id}`,
          l.digest ? `${l.version} (${l.digest})` : l.version,
        ]),
      ["Seed", `${decision.seed.algorithm} ${decision.seed.value}`],
      ["Ichnaea", decision.ichnaea],
      ["Decided", decision.decidedAt],
    ],
  };
}
