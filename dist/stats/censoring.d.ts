/** One trial of a quantity measure. A censored trial reached `time` and is known only to be ≥ it. */
export interface Duration {
    /** The value, such as seconds of the system's own time; at least 0. */
    readonly time: number;
    /**
     * True when the trial reached the plan's limit L, or for a bound that treats an infrastructure
     * timeout as censored.
     */
    readonly censored: boolean;
    /**
     * The trial's weight, by default 1: 1/r per trial counts each case once. The product-limit curve,
     * its quantiles and the restricted mean use it; `restrictedDifference` does not, because it
     * weights every case equally and every trial within a case equally.
     */
    readonly weight?: number;
}
/** One step of the product-limit curve, at an event time. */
export interface SurvivalStep {
    /** The event time. */
    readonly time: number;
    /** The weight still at risk just before `time`: every trial with a time ≥ `time`. */
    readonly atRisk: number;
    /** The weight of events at `time`. */
    readonly events: number;
    /** S(time), the estimated share above `time`. */
    readonly survival: number;
}
/**
 * The weighted Kaplan–Meier (product-limit) curve: S(t) = Π (1 − dᵢ/nᵢ) over event times tᵢ ≤ t.
 * A trial censored at an event time is still at risk at that time.
 */
export declare function kaplanMeier(sample: readonly Duration[]): SurvivalStep[];
/**
 * The q-quantile of the product-limit curve: the smallest event time where S ≤ 1 − q. Where S sits
 * on 1 − q over an interval, the quantile is the midpoint of that interval, up to the next event
 * time, as R's survival takes it: for an uncensored sample of even size, that is the ordinary
 * median. When the curve never falls to 1 − q, or sits on it to the end, the quantile is not
 * determined, and the result is "at least" the last time it could start: the largest time in the
 * sample (L when the trials are censored at L), or the start of the final plateau.
 */
export declare function survivalQuantile(sample: readonly Duration[], q: number): {
    readonly value: number;
} | {
    readonly atLeast: number;
};
/** The restricted mean up to the limit L: the area under the product-limit curve on [0, L]. */
export declare function restrictedMean(sample: readonly Duration[], limit: number): number;
/** One case's quantity trials under both arms. */
export interface CaseDurations {
    /** The case's ID. */
    readonly id: string;
    /** The base arm's trials. */
    readonly base: readonly Duration[];
    /** The candidate arm's trials. */
    readonly candidate: readonly Duration[];
}
/**
 * The mean over cases of the paired difference in mean min(t, L), candidate minus base, with the
 * censored trials counted per arm. It is unweighted: every case counts equally, and every trial
 * within a case equally, so `Duration.weight` is not used. It is restricted: it says nothing about
 * times beyond L. The plain mean of min(t, L) is exact only when every censored trial is censored at
 * L, so a censored trial below L, such as an infrastructure timeout, is refused. A case without a
 * trial in both arms is left out. Descriptive only.
 */
export declare function restrictedDifference(cases: readonly CaseDurations[], limit: number): {
    readonly estimate: number;
    readonly cases: number;
    readonly censored: {
        readonly base: number;
        readonly candidate: number;
    };
};
//# sourceMappingURL=censoring.d.ts.map