import type { Coverage } from "./estimate.ts";
import { critical } from "./normal.ts";
import { scoreDifferenceInterval } from "./score-difference.ts";
import type { Interval } from "./types.ts";

/** One case's values in a replayed run and in the recorded run it replays. */
export interface FidelityCase {
  /** The replayed run's trial values (A′ or B′). */
  readonly replayed: readonly number[];
  /** The recorded run's trial values (R_A or R_B). */
  readonly recorded: readonly number[];
}

/** Why a fidelity check has no interval. */
export type FidelityRefusal = "NOT_CHECKABLE_AT_ONE_TRIAL" | "ZERO_WIDTH";

/** The result of a fidelity check. */
export interface FidelityResult {
  /** The 90% interval of the mean per-case difference, replayed minus recorded, or null. */
  readonly interval: (Interval & { readonly coverage: Coverage }) | null;
  /** True when the interval lies inside (−margin, margin): replay fidelity shown. */
  readonly shown: boolean;
  /** Why there is no interval. */
  readonly reason?: FidelityRefusal;
}

const sum = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0);

/** The within-cell sum of squares. */
function squares(v: readonly number[]): number {
  const mean = sum(v) / v.length;
  return v.reduce((a, y) => a + (y - mean) ** 2, 0);
}

/** The cell mean's variance s²/r, with s² the cell's own unbiased within-cell variance. */
const cellVariance = (v: readonly number[]): number => squares(v) / (v.length - 1) / v.length;

/**
 * The replay fidelity check of attribution: TOST at 5% on each side, as the two-sided 90% interval
 * of the mean per-case difference, replayed minus recorded, with every case weighted equally.
 * Fidelity is shown when the interval lies inside (−margin, margin). Binary measures take the
 * stratified score interval. Scores take the within-case bootstrap variance corrected by
 * r/(r − 1), in closed form with no resampling noise: the bootstrap's limit s²(r − 1)/r² times
 * r/(r − 1) is s²/r, with s² each cell's own unbiased within-cell variance. A pooled s² would need
 * equal variances across cells, which score cells do not have: it is too small when the noisy cells
 * have fewer trials, which is where missing trials collect. A score case with one trial in either
 * run gives that cell no variance, so the check is refused. Coverage
 * is not validated. The replayed run is later than the recording, so drift is part of what the
 * check measures.
 */
export function fidelityCheck(input: {
  readonly valueType: "binary" | "score";
  readonly cases: readonly FidelityCase[];
  readonly margin: number;
}): FidelityResult {
  const { valueType, cases, margin } = input;
  if (!(margin > 0 && margin < 1))
    throw new RangeError(`the margin must be in (0, 1), got ${margin}`);
  if (cases.length === 0) throw new RangeError("a fidelity check needs at least one case");
  for (const c of cases) {
    if (c.replayed.length === 0 || c.recorded.length === 0)
      throw new RangeError("every case needs a trial in both the replayed and the recorded run");
    for (const v of [...c.replayed, ...c.recorded]) {
      const ok =
        valueType === "binary" ? v === 0 || v === 1 : Number.isFinite(v) && v >= 0 && v <= 1;
      if (!ok) throw new RangeError(`${v} is not a ${valueType} value`);
    }
  }
  let interval: Interval;
  if (valueType === "binary") {
    const strata = cases.map((c) => ({
      candidate: { successes: sum(c.replayed), trials: c.replayed.length },
      base: { successes: sum(c.recorded), trials: c.recorded.length },
    }));
    interval = scoreDifferenceInterval(strata, 0.9, "two", { weights: "equal" });
  } else {
    if (cases.some((c) => c.replayed.length < 2 || c.recorded.length < 2))
      return { interval: null, shown: false, reason: "NOT_CHECKABLE_AT_ONE_TRIAL" };
    const k = cases.length;
    const estimate =
      cases.reduce(
        (a, c) => a + sum(c.replayed) / c.replayed.length - sum(c.recorded) / c.recorded.length,
        0,
      ) / k;
    const variance =
      cases.reduce((a, c) => a + cellVariance(c.replayed) + cellVariance(c.recorded), 0) / (k * k);
    const half = critical(0.9, "two") * Math.sqrt(variance);
    interval = {
      estimate,
      lower: estimate - half,
      upper: estimate + half,
      level: 0.9,
      sided: "two",
      method: "within-case-variance",
    };
  }
  if (interval.lower === interval.upper)
    return { interval: null, shown: false, reason: "ZERO_WIDTH" };
  return {
    interval: { ...interval, coverage: "not-validated" },
    shown: interval.lower > -margin && interval.upper < margin,
  };
}
