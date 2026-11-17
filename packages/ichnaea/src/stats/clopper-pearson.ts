import { incompleteBeta } from "./beta.ts";
import { assertCount, assertLevel, type Count, type Interval, type Sided } from "./types.ts";

/** The p in (0, 1) where the increasing function f(p) reaches the target, by bisection. */
function invert(f: (p: number) => number, target: number): number {
  let low = 0;
  let high = 1;
  for (let i = 0; i < 1100; i++) {
    const mid = (low + high) / 2;
    if (mid === low || mid === high) break;
    if (f(mid) < target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * The exact Clopper–Pearson interval for one binomial proportion. Each bounded side holds its
 * share of 1 − level: (1 − level)/2 on two sides, 1 − level on one. Its coverage is at least the
 * level at every true rate. On the pooled count of independent trials with unequal rates (a
 * Poisson-binomial count), it stays conservative for the mean rate (Hoeffding 1956).
 * Zero trials give [0, 1] with an undefined (NaN) estimate.
 */
export function clopperPearson(count: Count, level = 0.95, sided: Sided = "two"): Interval {
  assertCount(count, "clopperPearson");
  assertLevel(level);
  const { successes: x, trials: n } = count;
  const method = "clopper-pearson";
  if (n === 0) return { estimate: Number.NaN, lower: 0, upper: 1, level, sided, method };
  const tail = sided === "two" ? (1 - level) / 2 : 1 - level;
  // P(X ≥ x | p) = I_p(x, n − x + 1) and P(X ≤ x | p) = 1 − I_p(x + 1, n − x). The boundary counts
  // have closed forms, which keep full precision at large n.
  let lower = 0;
  if (sided !== "upper" && x > 0)
    lower = x === n ? tail ** (1 / n) : invert((p) => incompleteBeta(p, x, n - x + 1), tail);
  let upper = 1;
  if (sided !== "lower" && x < n)
    upper =
      x === 0 ? 1 - tail ** (1 / n) : invert((p) => incompleteBeta(p, x + 1, n - x), 1 - tail);
  return { estimate: x / n, lower, upper, level, sided, method };
}
