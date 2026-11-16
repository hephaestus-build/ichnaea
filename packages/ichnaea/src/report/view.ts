import {
  type Decision,
  notComputedReason,
  type PowerEntry,
  type Real,
  type Run,
} from "../contracts/index.ts";

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
  /** The measure's ID. */
  readonly measure: string;
  /** The measure's tier: `primary` or `secondary`. */
  readonly tier: string;
  /** The measure's verdict. */
  readonly verdict: string;
  /** One entry for each arm: its rate, interval, available of planned trials and missing trials. */
  readonly arms: ReadonlyArray<{
    readonly arm: string;
    readonly rate: string;
    readonly interval: string;
    readonly n: string;
    readonly missing: number;
  }>;
  /**
   * The first comparison's difference with its bound, margin and flips; absent when the measure has
   * no comparison.
   */
  readonly difference?: {
    readonly estimate: string;
    readonly bound: string;
    readonly margin: string;
    readonly method: string;
    readonly negativeFlips: number;
    readonly positiveFlips: number;
    /**
     * Whether the bound is validated: only the comparison's non-inferiority result vouches for it
     * (decision 0015). A bound that is not validated is labelled so.
     */
    readonly validated: boolean;
    /** The numbers behind the difference axis, when the bound is finite. */
    readonly axis?: {
      readonly estimate: number;
      readonly lower: number;
      readonly margin: number;
      readonly validated: boolean;
    };
  };
  /** The measure's notes from the decision. */
  readonly notes: readonly string[];
}

/** One row of the power statement. */
export interface PowerRow {
  /** `planning` for the plan's statement, made before any call; `this run` for the run-time one. */
  readonly statement: "planning" | "this run";
  /** The measure's ID. */
  readonly measure: string;
  /** The number of applicable cases. */
  readonly cases: number;
  /** The trials per case and arm. */
  readonly replicates: number;
  /** The zero-noise floor in percentage points, or a dash when the entry was not computed. */
  readonly floor: string;
  /** The minimum detectable effect in percentage points, or `not computed`. */
  readonly mde: string;
  /** The margin in percentage points. */
  readonly margin: string;
  /** Whether the margin is within reach of the minimum detectable effect, or why it is unknown. */
  readonly reach: string;
  /** The assumption behind a computed entry, or the reason an entry was not computed. */
  readonly assumption: string;
}

/** One imputation of the sensitivity analysis for one measure. */
export interface SensitivityRow {
  /** The measure's ID. */
  readonly measure: string;
  /** How the missing trials were imputed, in words. */
  readonly imputation: string;
  /** The difference in percentage points, or a dash when there is no interval. */
  readonly difference: string;
  /**
   * The one-sided lower bound, labelled when it is not validated, or a dash when there is no
   * interval.
   */
  readonly bound: string;
  /** Whether the bound is validated, as in `MeasureRow`. */
  readonly validated: boolean;
  /** The measure's verdict under this imputation. */
  readonly verdict: string;
  /** `yes` when the imputation changes the measure's verdict, otherwise `no`. */
  readonly changes: string;
}

/** The view model of a decision. Every output renders from it, so they show the same numbers. */
export interface DecisionView {
  /** The report's title, which names the suite. */
  readonly title: string;
  /** The run's verdict, or `ESTIMATE-ONLY` when the decision gives none. */
  readonly verdict: string;
  /** What the verdict is about, shown next to it, for example "on these 12 cases". */
  readonly claim: string;
  /** Why the run has its verdict. */
  readonly reason: string;
  /** How the verdict was reached: estimand, bounds and adjustments. */
  readonly method: string;
  /** One row for each measure. */
  readonly measures: readonly MeasureRow[];
  /** Each hard gate with its result: `passed`, or `failed` with the number of failures. */
  readonly gates: ReadonlyArray<{ readonly gate: string; readonly result: string }>;
  /**
   * The cases whose binary outcome changed between the arms, from each measure's first comparison.
   */
  readonly flips: ReadonlyArray<{
    readonly measure: string;
    readonly case: string;
    readonly direction: string;
    readonly base: string;
    readonly candidate: string;
  }>;
  /** The planning power rows, then the run-time ones. */
  readonly power: readonly PowerRow[];
  /** The rows of the sensitivity analysis for missing trials. */
  readonly sensitivity: readonly SensitivityRow[];
  /** The missing trials of each arm and the outcome of the sensitivity analysis, in words. */
  readonly missingness: string;
  /** The keys of the configuration factors in which the base and candidate arms differ. */
  readonly differingFactors: readonly string[];
  /** The decision's limitations. */
  readonly limitations: readonly string[];
  /**
   * Label and value pairs that identify the run, its plan, arms, measures, plugins, seed and
   * version.
   */
  readonly lineage: ReadonlyArray<readonly [string, string]>;
}

/** The label of a bound that its comparison's non-inferiority result does not vouch for. */
export const NOT_VALIDATED = "(not validated)";

/**
 * A difference and its one-sided bound, or dashes when there is no interval to show. A bound is
 * labelled "not validated" unless the non-inferiority result is validated; the regression result
 * never vouches for it (decision 0015).
 */
function differenceCells(
  difference: Decision["measures"][number]["comparisons"][number]["difference"],
  nonInferiority: Decision["measures"][number]["comparisons"][number]["nonInferiority"],
): {
  estimate: string;
  bound: string;
} {
  // An estimate is never shown without its interval (REQ-129); the notes say why there is none.
  if (typeof difference.lower !== "number") return { estimate: "–", bound: "–" };
  return {
    estimate: points(difference.estimate),
    bound: `≥ ${points(difference.lower)}${nonInferiority.validated ? "" : ` ${NOT_VALIDATED}`}`,
  };
}

function powerRow(statement: PowerRow["statement"], p: PowerEntry): PowerRow {
  const common = {
    statement,
    measure: p.measure,
    cases: p.applicableCases,
    replicates: p.replicates,
    margin: `${(p.margin * 100).toFixed(1)} pts`,
  };
  if (!p.computed)
    return {
      ...common,
      floor: "–",
      mde: "not computed",
      reach: "unknown",
      assumption: notComputedReason(p),
    };
  return {
    ...common,
    floor: points(p.floor).replace("+", ""),
    mde: points(p.mde).replace("+", ""),
    reach: p.decidable ? "yes" : "no",
    assumption: p.assumption,
  };
}

const IMPUTATION: Readonly<Record<string, string>> = {
  "against-non-inferiority": "missing candidate trials fail, missing base trials pass",
  "against-regression": "missing candidate trials pass, missing base trials fail",
};

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
        ? `Estimate-only (${decision.measures[0]?.estimand ?? "fixed-cases"}): no statistical verdict. Rates carry 95% Wilson intervals; differences carry one-sided ${level}% lower bounds and are descriptive.`
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
                ...differenceCells(comparison.difference, comparison.nonInferiority),
                // A secondary measure has no margin: it is descriptive.
                margin:
                  m.tier === "secondary"
                    ? "–"
                    : `−${(comparison.margin * 100).toFixed(1)} pts${comparison.safetyMargin > 0 ? ` (safety ${(comparison.safetyMargin * 100).toFixed(1)})` : ""}`,
                method: comparison.difference.method,
                negativeFlips: comparison.flips.filter((f) => f.direction === "negative").length,
                positiveFlips: comparison.flips.filter((f) => f.direction === "positive").length,
                validated: comparison.nonInferiority.validated,
                ...(typeof comparison.difference.estimate === "number" &&
                typeof comparison.difference.lower === "number"
                  ? {
                      axis: {
                        estimate: comparison.difference.estimate,
                        lower: comparison.difference.lower,
                        margin: comparison.margin,
                        validated: comparison.nonInferiority.validated,
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
    power: [
      ...decision.power.planning.map((p) => powerRow("planning", p)),
      ...decision.power.run.map((p) => powerRow("this run", p)),
    ],
    sensitivity: decision.measures
      .flatMap((m) =>
        m.sensitivity.map((s) => ({
          measure: m.measure,
          imputation: IMPUTATION[s.imputation] ?? s.imputation,
          ...differenceCells(s.difference, s.nonInferiority),
          validated: s.nonInferiority.validated,
          verdict: s.verdict,
          changes: s.changesVerdict ? "yes" : "no",
        })),
      )
      .map(({ estimate, ...rest }) => ({ ...rest, difference: estimate })),
    missingness: `${decision.missingness.byArm.map((a) => `${a.arm}: ${a.missing} of ${a.planned} trials missing`).join("; ")}. ${
      decision.missingness.sensitivity === "not-needed"
        ? "No primary measure misses a trial in either arm, so no sensitivity analysis ran."
        : `A primary measure misses trials, so each verdict was decided again with the missing trials imputed against it: for non-inferiority, missing candidate trials fail and missing base trials pass; for regression, the reverse. ${
            decision.missingness.sensitivity === "unchanged"
              ? "No verdict changes."
              : "A verdict changes, and that measure is INCONCLUSIVE."
          }`
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
