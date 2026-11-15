/** Which side of an interval is bounded. `lower` is a one-sided lower bound: [lower, max]. */
export type Sided = "two" | "lower" | "upper";

/** An estimate with its interval. One-sided intervals extend to the parameter's bound. */
export interface Interval {
  readonly estimate: number;
  readonly lower: number;
  readonly upper: number;
  /** Confidence level of the interval, for example 0.95. */
  readonly level: number;
  readonly sided: Sided;
  /** The method's stable name, recorded in decisions. */
  readonly method: string;
  /** The question the interval answers, where the method fixes one (REQ-49). */
  readonly estimand?: "fixed-cases" | "sampled-cases";
}

/** A hypothesis test result. */
export interface TestResult {
  readonly statistic: number;
  /** One-sided p-value in the stated direction. */
  readonly p: number;
  readonly method: string;
}

/** Successes out of trials. */
export interface Count {
  readonly successes: number;
  readonly trials: number;
}

/** Throws when a count is not a valid binomial count. */
export function assertCount(count: Count, label: string): void {
  const { successes, trials } = count;
  if (
    !Number.isInteger(successes) ||
    !Number.isInteger(trials) ||
    trials < 0 ||
    successes < 0 ||
    successes > trials
  ) {
    throw new RangeError(`${label}: invalid count ${successes}/${trials}`);
  }
}

/** Throws unless a level is in (0, 1). */
export function assertLevel(level: number): void {
  if (!(level > 0 && level < 1))
    throw new RangeError(`confidence level must be in (0, 1), got ${level}`);
}
