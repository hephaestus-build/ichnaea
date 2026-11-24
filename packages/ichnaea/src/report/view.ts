import { resolutionLine } from "../plan/resolution.ts";
import type { Real } from "../contracts/primitives.ts";
import type { Decision } from "../contracts/records/decision.ts";
import { notComputedReason, type PowerEntry } from "../contracts/records/plan.ts";
import type { Run } from "../contracts/records/run.ts";

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

type DecisionNoise = NonNullable<Decision["measures"][number]["noise"]>;

/** One row of the per-measure table. */
export interface MeasureRow {
  /** The measure's ID. */
  readonly measure: string;
  /** The measure's tier: `primary` or `secondary`. */
  readonly tier: string;
  /** The measure's verdict. */
  readonly verdict: string;
  /** The quantity the measure estimates. */
  readonly estimand: string;
  /** One entry for each arm: its rate, interval, available of planned trials and missing trials. */
  readonly arms: ReadonlyArray<{
    readonly arm: string;
    readonly rate: string;
    readonly interval: string;
    readonly n: string;
    readonly missing: number;
    readonly denominators: {
      readonly observedCases: number | null;
      readonly plannedCases: number | null;
      readonly observedTrials: number;
      readonly plannedTrials: number;
      readonly caseCountsReason?: string;
    };
    readonly estimand: "equal-weight observed cases";
    readonly method: string;
    readonly level: number;
    readonly sidedness: string;
    readonly validity: { readonly validated: boolean; readonly limitations: readonly string[] };
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
    readonly sidedness: string;
    readonly level: number;
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
  /** Block counts and descriptive variance from the decision. */
  readonly blocks?: Decision["measures"][number]["blocks"];
  /** Within-case, between-block and across-case variance. */
  readonly noise?: Omit<DecisionNoise, "arms"> & {
    readonly arms: ReadonlyArray<
      Omit<DecisionNoise["arms"][number], "arm"> & { readonly arm: string }
    >;
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
  /** Cases flagged by detectors, counts, and recorded independence evidence. */
  readonly mustNever?: readonly {
    readonly measure: string;
    readonly note: string;
    readonly counts: readonly [number, number, number, number];
    readonly details: readonly string[];
  }[];
  /** Each hard gate with its result: `passed`, or `failed` with the number of failures. */
  readonly gates: ReadonlyArray<{
    readonly gate: string;
    readonly result: string;
  }>;
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
  /** The block-resolution estimates, with the model and any unavailability reason. */
  readonly resolution: readonly string[];
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

/** The start of a bound cell that has no bound; its reason follows in parentheses. */
export const NO_BOUND = "no bound";

/** Why a difference has no bound, in words, from what the record says about it. */
export function noBoundReason(
  difference: Decision["measures"][number]["comparisons"][number]["difference"],
): string {
  if (typeof difference.estimate !== "number") return "an arm has no value to compare";
  if (difference.method === "descriptive (no interval)") return "descriptive only, no interval";
  return `the ${difference.method} method gives none`;
}

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
  // An estimate is never shown without its interval or a stated reason why there is none (REQ-129).
  if (typeof difference.lower !== "number")
    return {
      estimate: typeof difference.estimate === "number" ? points(difference.estimate) : "–",
      bound: `${NO_BOUND} (${noBoundReason(difference)})`,
    };
  return {
    estimate: points(difference.estimate),
    bound: `≥ ${points(difference.lower)}${nonInferiority.validated ? "" : ` ${NOT_VALIDATED}`}`,
  };
}

function powerRow(
  statement: PowerRow["statement"],
  p: PowerEntry,
  id: (value: string) => string,
  prose: (text: string) => string,
): PowerRow {
  const common = {
    statement,
    measure: id(p.measure),
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
      assumption: prose(notComputedReason(p)),
    };
  return {
    ...common,
    floor: points(p.floor).replace("+", ""),
    mde: points(p.mde).replace("+", ""),
    reach: p.decidable ? "yes" : "no",
    assumption: prose(p.assumption),
  };
}

const IMPUTATION: Readonly<Record<string, string>> = {
  "against-non-inferiority": "missing candidate trials fail, missing base trials pass",
  "against-regression": "missing candidate trials pass, missing base trials fail",
};

/** A decision quotes each identifier it names in its prose: `'<id>'`, in the identifier grammar. */
const QUOTED_ID = /'[A-Za-z0-9][A-Za-z0-9._:/@+-]*'/g;

/** How `decisionView` builds the view. */
export interface DecisionViewOptions {
  /**
   * True for the view that the report lint reads: every identifier, where the view inserts it or
   * the decision quotes it, becomes `id`, so a case or arm named "significant" cannot block a
   * report. Numbers and Ichnaea's own prose stay as they are, so the lint still judges them.
   */
  readonly neutral?: boolean;
}

/**
 * Builds the view model from a decision record alone. It computes nothing new: every number comes
 * from the record (REQ-82, REQ-128).
 */
export function decisionView(
  decision: Decision,
  suite: string,
  lineage: Run["lineage"] = [],
  options: DecisionViewOptions = {},
): DecisionView {
  const neutral = options.neutral === true;
  const id = (value: string): string => (neutral ? "id" : value);
  const prose = (text: string): string => (neutral ? text.replaceAll(QUOTED_ID, "'id'") : text);
  // An arm with an opaque name (`a`, `b`) is shown with its role, so a reader knows its side.
  const armLabel = (name: string): string => {
    const role = decision.arms.find((a) => a.name === name)?.role;
    return role === undefined || role === name ? id(name) : `${role} (${id(name)})`;
  };
  const verdict = decision.verdict ?? "ESTIMATE-ONLY";
  const level = Math.round((1 - decision.alpha) * 100);
  const lineageRows: ReadonlyArray<readonly [string, string]> = [
    ["Run", decision.run],
    ["Plan", decision.plan],
    ["Run record", decision.runDigest],
    ...decision.arms.map((a): readonly [string, string] => [
      `Arm ${a.name} (${a.role})`,
      a.identity,
    ]),
    ...decision.measures.map((m): readonly [string, string] => [`Measure ${m.measure}`, m.version]),
    ...lineage
      .filter((l) => l.kind !== "measure")
      .map((l): readonly [string, string] => [
        `${l.kind[0]?.toUpperCase() ?? ""}${l.kind.slice(1)} ${l.id}`,
        l.digest ? `${l.version} (${l.digest})` : l.version,
      ]),
    ["Seed", `${decision.seed.algorithm} ${decision.seed.value}`],
    ["Ichnaea", decision.ichnaea],
    ["Decided", decision.decidedAt],
  ];
  return {
    title: `Ichnaea decision: ${id(suite)}`,
    verdict,
    claim: prose(decision.scope),
    reason: prose(decision.reason),
    method:
      decision.mode === "estimate-only"
        ? `Estimate-only (${decision.measures[0]?.estimand ?? "fixed-cases"}): no statistical verdict. Rates give cases equal weight; differences carry one-sided ${level}% lower bounds and are descriptive.`
        : `Estimand ${decision.measures[0]?.estimand ?? "fixed-cases"}; one-sided ${level}% lower bounds for differences (candidate minus base); intersection-union over primary measures; Holm across regression tests.`,
    measures: decision.measures.map((m) => {
      const comparison = m.comparisons[0];
      return {
        measure: id(m.measure),
        tier: m.tier,
        verdict: m.verdict,
        estimand: m.estimand,
        arms: m.arms.map((a) => ({
          arm: armLabel(a.arm),
          rate: percent(a.rate.estimate),
          interval:
            typeof a.rate.lower === "number" && typeof a.rate.upper === "number"
              ? `${percent(a.rate.lower)} to ${percent(a.rate.upper)}${a.intervalValidity?.validated === false ? ` ${NOT_VALIDATED}` : ""}`
              : "No interval yet: the available trials do not give one.",
          n: `${a.availability.available} of ${a.availability.planned}`,
          missing: a.availability.missing,
          denominators: {
            observedCases: a.caseAvailability?.observed ?? null,
            plannedCases: a.caseAvailability?.planned ?? null,
            observedTrials: a.availability.available,
            plannedTrials: a.availability.planned,
            ...(a.caseAvailability
              ? {}
              : { caseCountsReason: "the decision predates case counts" }),
          },
          estimand: "equal-weight observed cases",
          method: a.rate.method,
          level: a.rate.level,
          sidedness: a.rate.sided,
          validity: a.intervalValidity ?? {
            validated: false,
            limitations: ["the decision records no interval validity"],
          },
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
                sidedness: comparison.difference.sided,
                level: comparison.difference.level,
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
        ...(m.blocks ? { blocks: m.blocks } : {}),
        ...(m.noise
          ? {
              noise: {
                ...m.noise,
                arms: m.noise.arms.map((a) => ({ ...a, arm: armLabel(a.arm) })),
              },
            }
          : {}),
        notes: m.notes.map(prose),
      };
    }),
    ...(decision.mustNever
      ? {
          mustNever: decision.mustNever.map((entry) => ({
            measure: id(entry.measure),
            note: `${entry.detector === "model" ? "Model flags" : "Deterministic detector hits"}. Scope: ${id(entry.scope)}. Counts use fresh trials.`,
            counts: [entry.planned, entry.clean, entry.hits, entry.missing] as const,
            details: [
              ...entry.controls.map(
                (control) =>
                  `${id(control.pattern)} positive control (${id(control.case)}): ${control.status}.`,
              ),
              ...entry.cases.map(
                (row) =>
                  `${id(row.case)}: ${row.status}, ${row.observed} of ${row.planned} trials scored; contexts ${row.contexts.map(id).join(", ") || "unavailable"}.`,
              ),
              ...entry.windows.map(
                (window) => `Block ${window.block}: ${window.startedAt} to ${window.endedAt}.`,
              ),
              ...(entry.windows.length === 0
                ? ["Block windows unavailable."]
                : [
                    "Back-to-back blocks protect against instance, cache and sandbox state. They protect against a provider shock to one arm only when the blocks are spread in time.",
                  ]),
            ],
          })),
        }
      : {}),
    gates: decision.gates.map((g) => ({
      gate: id(g.gate),
      result: g.passed ? "passed" : `failed (${g.failures})`,
    })),
    flips: decision.measures.flatMap((m) =>
      (m.comparisons[0]?.flips ?? []).map((f) => ({
        measure: id(m.measure),
        case: id(f.case),
        direction: f.direction,
        base: percent(f.base),
        candidate: percent(f.candidate),
      })),
    ),
    power:
      decision.resolution === undefined
        ? [
            ...decision.power.planning.map((p) => powerRow("planning", p, id, prose)),
            ...decision.power.run.map((p) => powerRow("this run", p, id, prose)),
          ]
        : [],
    resolution: (decision.resolution ?? []).map((entry) =>
      prose(resolutionLine(entry, id(entry.measure))),
    ),
    sensitivity: decision.measures
      .flatMap((m) =>
        m.sensitivity.map((s) => ({
          measure: id(m.measure),
          imputation: IMPUTATION[s.imputation] ?? s.imputation,
          ...differenceCells(s.difference, s.nonInferiority),
          validated: s.nonInferiority.validated,
          verdict: s.verdict,
          changes: s.changesVerdict ? "yes" : "no",
        })),
      )
      .map(({ estimate, ...rest }) => ({ ...rest, difference: estimate })),
    missingness: `${decision.missingness.byArm.map((a) => `${armLabel(a.arm)}: ${a.missing} of ${a.planned} trials missing`).join("; ")}. ${
      decision.missingness.sensitivity === "not-needed"
        ? "No primary measure misses a trial in either arm, so no sensitivity analysis ran."
        : `A primary measure misses trials, so each verdict was decided again with the missing trials imputed against it: for non-inferiority, missing candidate trials fail and missing base trials pass; for regression, the reverse. ${
            decision.missingness.sensitivity === "unchanged"
              ? "No verdict changes."
              : "A verdict changes, and that measure is INCONCLUSIVE."
          }`
    }`,
    differingFactors: decision.differingFactors.map(id),
    limitations: decision.limitations.map(prose),
    lineage: lineageRows.map(([label, value]) => [id(label), id(value)]),
  };
}
