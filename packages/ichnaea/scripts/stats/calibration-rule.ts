// The judge calibration rule of ./calibration, in the shape that the operating-characteristics
// study (calibration-rule-study.ts) receives as a parameter.
import { CALIBRATION_DEFAULTS } from "../../src/calibration/index.ts";
import { bootstrapCalibration, calibrated } from "../../src/calibration/engine.ts";

import type { CalibrationRule } from "./calibration-rule-study.ts";

/** The rule's settings. */
export interface RuleSettings {
  /** The largest accepted shortfall in agreement (D): AC1 for yes/no labels, ordinal alpha for levels. */
  readonly agreementTolerance: number;
  /** The largest accepted shortfall in sensitivity and in specificity, for yes/no labels. */
  readonly rateTolerance: number;
  /** Item resamples per study. */
  readonly resamples: number;
  /** The rater floor; the registered one when absent. */
  readonly raterFloor?: { readonly ac1: number; readonly alpha: number };
  /** The bias gate's equivalence margin; ARM_BIAS_MARGIN when absent. */
  readonly armBiasMargin?: { readonly binary: number; readonly levels: number };
}

/** The registered equivalence margins of the bias between base and candidate. */
export const ARM_BIAS_MARGIN: { readonly binary: number; readonly levels: number } =
  CALIBRATION_DEFAULTS.armBiasMargin;

/**
 * The conditions this rule reports, as the study's columns name them:
 * - `ratersFloor`, the precondition: rater–rater agreement reaches the rater floor;
 * - yes/no judges: `ac1` (the agreement gap D with AC1), `sensitivity` and `specificity`;
 * - level judges: `alphaOrdinal` (the agreement gap D with ordinal alpha);
 * - `armBias`: the 90 % interval of the bias between base and candidate lies within
 *   ±ARM_BIAS_MARGIN. The known-worse configuration takes no part in it.
 */
export const CONDITIONS = [
  "ratersFloor",
  "ac1",
  "sensitivity",
  "specificity",
  "alphaOrdinal",
  "armBias",
] as const;

/** The rule of ./calibration with the given values. A study passes when the judge is calibrated. */
export function calibrationRule(settings: RuleSettings): CalibrationRule {
  const values = {
    ...settings,
    raterFloor: settings.raterFloor ?? CALIBRATION_DEFAULTS.raterFloor,
    armBiasMargin: settings.armBiasMargin ?? ARM_BIAS_MARGIN,
  };
  const evaluate: CalibrationRule["evaluate"] = (study, rng) => {
    const boot = bootstrapCalibration(study, values, rng);
    const { ratersFloor, agreement, sensitivity, specificity, armBias } = boot.conditions;
    return {
      pass: calibrated(boot),
      conditions: {
        ratersFloor: ratersFloor.holds,
        ...(study.scale === "levels"
          ? { alphaOrdinal: agreement!.holds }
          : {
              ac1: agreement!.holds,
              sensitivity: sensitivity!.holds,
              specificity: specificity!.holds,
            }),
        armBias: armBias.holds,
      },
      shownBound: boot.armBias.shownBound,
      armBias: boot.armBias.estimate,
      nanReplicates: boot.undefinedResamples,
      replicates: settings.resamples,
      ...(boot.slope === undefined ? {} : { slope: boot.slope }),
    };
  };
  return { conditions: CONDITIONS, evaluate };
}
