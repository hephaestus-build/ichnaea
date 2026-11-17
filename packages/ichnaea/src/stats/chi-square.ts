import { regularizedGammaP, regularizedGammaQ } from "./beta.ts";

/**
 * The p-quantile of the χ² distribution with df > 0 degrees of freedom, by bisection: on the lower
 * tail P(df/2, x/2) = p up to p = 1/2, and on the upper tail Q(df/2, x/2) = 1 − p above it, where
 * 1 − P would round the small tail away. It refuses any p outside (0, 1).
 */
export function chiSquareQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`the probability must be in (0, 1), got ${p}`);
  if (!(Number.isFinite(df) && df > 0))
    throw new RangeError(`the degrees of freedom must be finite and positive, got ${df}`);
  const upperTail = p > 0.5;
  // Below the root when true: the lower tail is still under p, or the upper tail still above 1 − p.
  const below = upperTail
    ? (x: number): boolean => regularizedGammaQ(df / 2, x / 2) > 1 - p
    : (x: number): boolean => regularizedGammaP(df / 2, x / 2) < p;
  let low = 0;
  let high = Math.max(1, df);
  while (below(high)) high *= 2;
  for (let i = 0; i < 1100; i++) {
    const mid = (low + high) / 2;
    if (mid === low || mid === high) break;
    if (below(mid)) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}
