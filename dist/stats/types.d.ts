/** Which side of an interval is bounded. `lower` is a one-sided lower bound: [lower, max]. */
export type Sided = "two" | "lower" | "upper";
/** How cases weigh in a mean: each case equally, or each family equally. */
export type Weighting = "per-case" | "per-family";
/** An estimate with its interval. One-sided intervals extend to the parameter's bound. */
export interface Interval {
    /** The point estimate. */
    readonly estimate: number;
    /** The interval's lower bound. */
    readonly lower: number;
    /** The interval's upper bound. */
    readonly upper: number;
    /** Confidence level of the interval, for example 0.95. */
    readonly level: number;
    /** Which side of the interval is bounded. */
    readonly sided: Sided;
    /** The method's stable name, recorded in decisions. */
    readonly method: string;
    /** The question the interval answers, where the method fixes one (REQ-49). */
    readonly estimand?: "fixed-cases" | "sampled-cases";
}
/** A hypothesis test result. */
export interface TestResult {
    /** The test statistic. */
    readonly statistic: number;
    /** One-sided p-value in the stated direction. */
    readonly p: number;
    /** The test's stable name, recorded in decisions. */
    readonly method: string;
}
/** Successes out of trials. */
export interface Count {
    /** The number of successes, an integer from 0 to `trials`. */
    readonly successes: number;
    /** The number of trials, a non-negative integer. */
    readonly trials: number;
}
/** Throws when a count is not a valid binomial count. */
export declare function assertCount(count: Count, label: string): void;
/** Throws unless a level is in (0, 1). */
export declare function assertLevel(level: number): void;
//# sourceMappingURL=types.d.ts.map