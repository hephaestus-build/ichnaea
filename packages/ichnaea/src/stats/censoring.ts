/** One trial of a quantity measure. A censored trial reached `time` and is known only to be ≥ it. */
export interface Duration {
  /** The value, such as seconds of the system's own time; at least 0. */
  readonly time: number;
  /**
   * True when the trial reached the plan's limit L, or for a bound that treats an infrastructure
   * timeout as censored.
   */
  readonly censored: boolean;
  /** The trial's weight, by default 1: 1/r per trial counts each case once. */
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

function check(sample: readonly Duration[]): void {
  if (sample.length === 0) throw new RangeError("a survival curve needs at least one trial");
  for (const d of sample) {
    if (!(Number.isFinite(d.time) && d.time >= 0))
      throw new RangeError(`a duration must be finite and at least 0, got ${d.time}`);
    const w = d.weight ?? 1;
    if (!(Number.isFinite(w) && w > 0)) throw new RangeError(`a weight must be positive, got ${w}`);
  }
}

/**
 * The weighted Kaplan–Meier (product-limit) curve: S(t) = Π (1 − dᵢ/nᵢ) over event times tᵢ ≤ t.
 * A trial censored at an event time is still at risk at that time.
 */
export function kaplanMeier(sample: readonly Duration[]): SurvivalStep[] {
  check(sample);
  const sorted = sample.toSorted((a, b) => a.time - b.time);
  let atRisk = sorted.reduce((a, d) => a + (d.weight ?? 1), 0);
  let survival = 1;
  const steps: SurvivalStep[] = [];
  for (let i = 0; i < sorted.length;) {
    const time = sorted[i]!.time;
    let events = 0;
    let leaving = 0;
    for (; i < sorted.length && sorted[i]!.time === time; i++) {
      const w = sorted[i]!.weight ?? 1;
      leaving += w;
      if (!sorted[i]!.censored) events += w;
    }
    if (events > 0) {
      survival *= 1 - events / atRisk;
      steps.push({ time, atRisk, events, survival });
    }
    atRisk -= leaving;
  }
  return steps;
}

/** The tolerance on S = 1 − q, R's √ε in survival's quantile.survfit. */
const PLATEAU = Math.sqrt(Number.EPSILON);

/**
 * The q-quantile of the product-limit curve: the smallest event time where S ≤ 1 − q. Where S sits
 * on 1 − q over an interval, the quantile is the midpoint of that interval, up to the next event
 * time, as R's survival takes it: for an uncensored sample of even size, that is the ordinary
 * median. When the curve never falls to 1 − q, or sits on it to the end, the quantile is not
 * determined, and the result is "at least" the last time it could start: the largest time in the
 * sample (L when the trials are censored at L), or the start of the final plateau.
 */
export function survivalQuantile(
  sample: readonly Duration[],
  q: number,
): { readonly value: number } | { readonly atLeast: number } {
  if (!(q > 0 && q < 1)) throw new RangeError(`a quantile must be in (0, 1), got ${q}`);
  const steps = kaplanMeier(sample);
  const index = steps.findIndex((s) => s.survival <= 1 - q + PLATEAU);
  if (index === -1) return { atLeast: Math.max(...sample.map((d) => d.time)) };
  const step = steps[index]!;
  if (Math.abs(step.survival - (1 - q)) > PLATEAU) return { value: step.time };
  const next = steps[index + 1];
  return next ? { value: (step.time + next.time) / 2 } : { atLeast: step.time };
}

/** The restricted mean up to the limit L: the area under the product-limit curve on [0, L]. */
export function restrictedMean(sample: readonly Duration[], limit: number): number {
  if (!(Number.isFinite(limit) && limit > 0)) throw new RangeError(`the limit must be positive`);
  let area = 0;
  let last = 0;
  let survival = 1;
  for (const s of kaplanMeier(sample)) {
    if (s.time >= limit) break;
    area += survival * (s.time - last);
    last = s.time;
    survival = s.survival;
  }
  return area + survival * (limit - last);
}

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
 * censored trials counted per arm. It is restricted: it says nothing about times beyond L. A case
 * without a trial in both arms is left out. Descriptive only.
 */
export function restrictedDifference(
  cases: readonly CaseDurations[],
  limit: number,
): {
  readonly estimate: number;
  readonly cases: number;
  readonly censored: { readonly base: number; readonly candidate: number };
} {
  if (!(Number.isFinite(limit) && limit > 0)) throw new RangeError(`the limit must be positive`);
  const censored = { base: 0, candidate: 0 };
  const differences: number[] = [];
  const mean = (trials: readonly Duration[]): number => {
    check(trials);
    return trials.reduce((a, d) => a + Math.min(d.time, limit), 0) / trials.length;
  };
  for (const c of cases) {
    if (c.base.length === 0 || c.candidate.length === 0) continue;
    censored.base += c.base.filter((d) => d.censored).length;
    censored.candidate += c.candidate.filter((d) => d.censored).length;
    differences.push(mean(c.candidate) - mean(c.base));
  }
  const estimate = differences.length
    ? differences.reduce((a, b) => a + b, 0) / differences.length
    : Number.NaN;
  return { estimate, cases: differences.length, censored };
}
