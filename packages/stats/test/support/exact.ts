// Exact coverage of the fixed-cases lower bound for few cases with identical rates, by enumerating
// every outcome: the bound depends only on the multiset of per-case outcome pairs.
import { scoreDifferenceInterval, type Stratum } from "../../src/index.ts";

function binom(n: number, k: number, p: number): number {
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return c * p ** k * (1 - p) ** (n - k);
}

function fact(n: number): number {
  return n <= 1 ? 1 : n * fact(n - 1);
}

/** Exact P(lower ≤ truth) for k cases, r replicates, base rate p and candidate rate q (all cases alike). */
export function exactCoverage(k: number, r: number, p: number, q: number, level = 0.95): number {
  const outcomes: Array<{ x1: number; x2: number; prob: number }> = [];
  for (let x1 = 0; x1 <= r; x1++)
    for (let x2 = 0; x2 <= r; x2++)
      outcomes.push({ x1, x2, prob: binom(r, x1, q) * binom(r, x2, p) });
  const truth = q - p;
  let covered = 0;
  // Enumerate multisets of k outcomes (the bound depends only on the multiset) with multinomial weights.
  const m = outcomes.length;
  const counts = Array.from({ length: m }, () => 0);
  const recurse = (index: number, left: number): void => {
    if (index === m - 1) {
      counts[index] = left;
      let weight = fact(k);
      const strata: Stratum[] = [];
      counts.forEach((c, i) => {
        const o = outcomes[i] as { x1: number; x2: number; prob: number };
        weight *= o.prob ** c / fact(c);
        for (let t = 0; t < c; t++)
          strata.push({
            candidate: { successes: o.x1, trials: r },
            base: { successes: o.x2, trials: r },
          });
      });
      if (weight > 0 && scoreDifferenceInterval(strata, level, "lower").lower <= truth + 1e-12)
        covered += weight;
      return;
    }
    for (let c = 0; c <= left; c++) {
      counts[index] = c;
      recurse(index + 1, left - c);
    }
  };
  recurse(0, k);
  return covered;
}
