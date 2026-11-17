import type { Coverage } from "./estimate.ts";
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
    readonly interval: (Interval & {
        readonly coverage: Coverage;
    }) | null;
    /** True when the interval lies inside (−margin, margin): replay fidelity shown. */
    readonly shown: boolean;
    /** Why there is no interval. */
    readonly reason?: FidelityRefusal;
}
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
export declare function fidelityCheck(input: {
    readonly valueType: "binary" | "score";
    readonly cases: readonly FidelityCase[];
    readonly margin: number;
}): FidelityResult;
//# sourceMappingURL=fidelity.d.ts.map