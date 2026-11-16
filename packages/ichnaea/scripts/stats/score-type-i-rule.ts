// The rule of the score type-I study (VALIDATION.md, "The type-I study"), in one place: the runner
// applies it while it screens and confirms, and the collector applies it again to the outputs.
//
// A point records its rejections at every level from the same repetitions. A level's estimate is
// p̂ = hits / reps, with standard error √(p̂(1 − p̂)/reps), from the estimate itself.

/** The levels: α = 0.05, and the Holm levels α/m for m = 2, 3 and 4. */
export const LEVELS = [0.05, 0.025, 0.05 / 3, 0.0125] as const;
export const ALPHA = LEVELS[0];

/**
 * Resamples of the permutation test inside the study. (1 + B)·level is a whole number at every
 * level (12, 6, 4 and 3), so the Monte Carlo test's size under exchangeability is exactly the level.
 * With 99 resamples it would be 0.02, 0.01 and 0.01 at the three Holm levels.
 */
export const STUDY_RESAMPLES = 239;

/** A confirmation runs until every level's standard error is at most this. */
export const CONFIRM_SE = 0.0005;

export const se = (p: number, n: number): number => Math.sqrt((p * (1 - p)) / n);

/**
 * Whether a p-value of the study's tests rejects at a level. The resampling tests' p-values are
 * (1 + count)/240 and land on the levels exactly, where the two sides can differ in the last bit,
 * so the comparison allows a relative 1e-9.
 */
export const studyRejects = (p: number, level: number): boolean => p <= level * (1 + 1e-9);

/** Per-level estimates from per-level rejection counts. */
export const estimates = (hits: readonly number[], reps: number): number[] =>
  hits.map((h) => h / reps);

/** A screened point is confirmed when, at any level, its estimate is above level − 2·SE. */
export function needsConfirmation(hits: readonly number[], reps: number): boolean {
  return LEVELS.some((level, i) => {
    const p = (hits[i] as number) / reps;
    return p > level - 2 * se(p, reps);
  });
}

/** The levels at which an estimate fails: estimate − 3·SE above the level. */
export function failingLevels(hits: readonly number[], reps: number): number[] {
  return LEVELS.filter((level, i) => {
    const p = (hits[i] as number) / reps;
    return p - 3 * se(p, reps) > level;
  });
}

export const failsAtAnyLevel = (hits: readonly number[], reps: number): boolean =>
  failingLevels(hits, reps).length > 0;

/** The fewest repetitions of a confirmation: those that reach CONFIRM_SE at 0.05 (190,000). */
export const minConfirmReps = (confirmSe: number): number =>
  Math.ceil((0.05 * 0.95) / confirmSe ** 2);

/**
 * Whether a confirmation may stop: at least minConfirmReps, and every level's standard error at
 * most confirmSe. An estimate of 0 has a standard error of 0, so the minimum keeps one batch from
 * stopping the loop.
 */
export function confirmationDone(
  hits: readonly number[],
  reps: number,
  confirmSe: number,
): boolean {
  return (
    reps >= minConfirmReps(confirmSe) &&
    LEVELS.every((_level, i) => se((hits[i] as number) / reps, reps) <= confirmSe)
  );
}

/** How bad a point is, to rank it: the largest estimate/level over the levels. */
export const worstness = (hits: readonly number[], reps: number): number =>
  Math.max(...LEVELS.map((level, i) => (hits[i] as number) / reps / level));

/** Per-level counts written as a comma-separated list, and read back. */
export const formatCounts = (counts: readonly number[]): string => counts.join(",");
export function parseCounts(text: string | undefined): number[] {
  const counts = (text ?? "").split(",").map(Number);
  if (counts.length !== LEVELS.length || counts.some((c) => !Number.isInteger(c) || c < 0))
    throw new Error(`expected ${LEVELS.length} counts, got '${text}'`);
  return counts;
}

/**
 * The paired comparison of the shipped test with the study's on the same repetitions: the mean
 * difference (shipped − study) and its variance, from the discordant counts n10 (only the shipped
 * test rejects) and n01 (only the study's test rejects).
 */
export function pairedDifference(
  n10: number,
  n01: number,
  reps: number,
): { mean: number; variance: number } {
  const mean = (n10 - n01) / reps;
  return { mean, variance: (n10 + n01 - (n10 - n01) ** 2 / reps) / reps ** 2 };
}

/**
 * The pooled check over a set of points: mean of (shipped − study), its standard error
 * √(Σ variance)/N, and whether it passes. It is one-sided: it fails only when the shipped test
 * rejects more often than the study's by more than 3 pooled standard errors. A negative mean, the
 * shipped test more conservative, is reported.
 */
export function pooledCheck(points: readonly { mean: number; variance: number }[]): {
  points: number;
  meanDifference: number;
  pooledSe: number;
  passes: boolean;
} {
  const n = points.length;
  if (n === 0) return { points: 0, meanDifference: 0, pooledSe: 0, passes: true };
  const meanDifference = points.reduce((a, p) => a + p.mean, 0) / n;
  const pooledSe = Math.sqrt(points.reduce((a, p) => a + p.variance, 0)) / n;
  return { points: n, meanDifference, pooledSe, passes: meanDifference <= 3 * pooledSe };
}

/**
 * k1 at one trial per case: the smallest swept k from which every larger swept k passes, or null
 * when the largest fails.
 */
export function k1Of(counts: readonly number[], fails: (k: number) => boolean): number | null {
  return counts.find((_k, i) => counts.slice(i).every((k) => !fails(k))) ?? null;
}
