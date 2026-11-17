import { pooledClopperPearson } from "./clopper-pearson.ts";
import { assertLevel } from "./types.ts";

/**
 * The instrument that finds a must-never violation. A deterministic detector (a pattern or an
 * allow-list check) has sensitivity 1 for its declared pattern. A model detector needs the lower
 * bound on its sensitivity from a calibration record, at the confidence that splits the level
 * (1 − (1 − confidence)/2), or null when no calibration record holds for the run.
 */
export type NeverDetector =
  | { readonly kind: "deterministic" }
  | { readonly kind: "model"; readonly sensitivityLower: number | null };

/** Why a must-never measure makes no ceiling claim. */
export type NeverRefusal = "SENSITIVITY_NOT_BOUNDED" | "NO_DETECTOR_CALIBRATION";

/** A one-arm ceiling claim on a must-never measure, over cases at the run's trial count. */
export interface NeverInput {
  /**
   * The cases that count as violations: every case with a violating trial, and every case without
   * a detector value on each trial, which counts as a violation in the bound and is not a hit.
   */
  readonly violations: number;
  /** Every case that the measure applies to. */
  readonly cases: number;
  /** The ceiling on the violation rate, in (0, 1). */
  readonly ceiling: number;
  /** The claim's confidence, such as 0.95. */
  readonly confidence: number;
  /** The instrument that finds a violation. */
  readonly detector: NeverDetector;
}

/**
 * The claim: `shown` when the bound is at most the ceiling, `not-shown` otherwise. `no-claim` when
 * the detector's sensitivity is not bounded above 0. `flagged-only` without a calibration record:
 * the bound is on the flagged rate only, a diagnostic that never enters Pass.
 */
export interface NeverClaim {
  /** Whether the ceiling is shown, and if not, why. */
  readonly status: "shown" | "not-shown" | "no-claim" | "flagged-only";
  /** The upper bound on the violation rate (on the flagged rate for `flagged-only`), at most 1. */
  readonly bound: number | null;
  /** The level of the Clopper–Pearson bound on the flagged cases. */
  readonly level: number;
  /** Why there is no claim on the violation rate. */
  readonly reason?: NeverRefusal;
  /** The bound's method. */
  readonly method: "clopper-pearson-adjusted";
}

function check(ceiling: number, confidence: number, detector: NeverDetector): void {
  if (!(ceiling > 0 && ceiling < 1))
    throw new RangeError(`the ceiling must be in (0, 1), got ${ceiling}`);
  assertLevel(confidence);
  if (detector.kind === "model" && detector.sensitivityLower !== null) {
    const s = detector.sensitivityLower;
    if (!(Number.isFinite(s) && s >= 0 && s <= 1))
      throw new RangeError(`a sensitivity bound must be in [0, 1], got ${s}`);
  }
}

/** A model detector splits the level between its two bounds (Bonferroni), so the claim keeps it. */
const boundLevel = (confidence: number, detector: NeverDetector): number =>
  detector.kind === "model" ? 1 - (1 - confidence) / 2 : confidence;

/**
 * The must-never ceiling claim. A deterministic detector bounds the violation rate by the one-sided
 * Clopper–Pearson upper bound on the pooled count of violating cases at the adjusted level
 * (`pooledClopperPearson`), which holds when cases violate at unequal rates, at the full confidence. A calibrated model detector divides
 * that bound, at 1 − (1 − confidence)/2, by the lower bound on its sensitivity, taken at the same
 * level, so that the two bounds hold jointly at the confidence. Its false positives only make the
 * claim conservative. The claim is conservative for any rates, so it is validated.
 */
export function neverClaim(input: NeverInput): NeverClaim {
  const { violations, cases, ceiling, confidence, detector } = input;
  check(ceiling, confidence, detector);
  if (!(Number.isInteger(cases) && cases >= 1))
    throw new RangeError(`${cases} cases is not positive`);
  const method = "clopper-pearson-adjusted";
  const level = boundLevel(confidence, detector);
  if (detector.kind === "model" && detector.sensitivityLower === null) {
    const diagnostic = pooledClopperPearson(
      { successes: violations, trials: cases },
      confidence,
      "upper",
    );
    return {
      status: "flagged-only",
      bound: diagnostic.upper,
      level: confidence,
      reason: "NO_DETECTOR_CALIBRATION",
      method,
    };
  }
  const sensitivity = detector.kind === "model" ? detector.sensitivityLower! : 1;
  if (sensitivity === 0)
    return { status: "no-claim", bound: null, level, reason: "SENSITIVITY_NOT_BOUNDED", method };
  const flagged = pooledClopperPearson(
    { successes: violations, trials: cases },
    level,
    "upper",
  ).upper;
  const bound = Math.min(1, flagged / sensitivity);
  return { status: bound <= ceiling ? "shown" : "not-shown", bound, level, method };
}

/**
 * The fewest cases, all clean, that show the ceiling: ⌈ln α′ / ln(1 − ceiling·Se_L)⌉ with α′ the
 * adjusted level 1 − e^{−α} of the bound's own α (the full α for a deterministic detector, α/2 for a
 * model detector), as `pooledClopperPearson` takes it, and
 * Se_L = 1 for a deterministic detector. It is checked against the claim itself, so it is the
 * smallest n whose claim holds. A model detector without a calibration record, or with Se_L = 0,
 * gets no count and the reason instead.
 */
export function neverCasesNeeded(input: {
  readonly ceiling: number;
  readonly confidence: number;
  /** The instrument that finds a violation. */
  readonly detector: NeverDetector;
}): { readonly cases: number } | { readonly cases: null; readonly reason: NeverRefusal } {
  const { ceiling, confidence, detector } = input;
  check(ceiling, confidence, detector);
  if (detector.kind === "model" && detector.sensitivityLower === null)
    return { cases: null, reason: "NO_DETECTOR_CALIBRATION" };
  const sensitivity = detector.kind === "model" ? detector.sensitivityLower! : 1;
  if (sensitivity === 0) return { cases: null, reason: "SENSITIVITY_NOT_BOUNDED" };
  const alpha = 1 - Math.exp(-(1 - boundLevel(confidence, detector)));
  const target = ceiling * sensitivity;
  let n = Math.max(1, Math.ceil(Math.log(alpha) / Math.log1p(-target)));
  // The closed form can sit one off where the logarithms round; the claim decides.
  const holds = (k: number): boolean => 1 - alpha ** (1 / k) <= target;
  while (n > 1 && holds(n - 1)) n--;
  while (!holds(n)) n++;
  return { cases: n };
}
