// Exact coverage and type-I error for few cases with identical rates, by enumerating every outcome.
// The fixed-cases bound and the exact test depend only on the multiset of per-case outcome pairs, so
// each multiset is evaluated once per (k, r) and reweighted for every pair of rates.
import { exactStratifiedTest, fixedCasesInterval, type CaseCounts } from "../../src/index.ts";

function binom(n: number, k: number, p: number): number {
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return c * p ** k * (1 - p) ** (n - k);
}

function fact(n: number): number {
  return n <= 1 ? 1 : n * fact(n - 1);
}

interface Multiset {
  /** How many cases have each outcome pair (index into `pairs`). */
  readonly counts: readonly number[];
  readonly lower: number;
  readonly regressionP: number;
}

interface Enumeration {
  readonly k: number;
  readonly r: number;
  /** Outcome pairs: candidate successes x1 and base successes x2 of r trials each. */
  readonly pairs: ReadonlyArray<{ readonly x1: number; readonly x2: number }>;
  readonly multisets: readonly Multiset[];
}

const cache = new Map<string, Enumeration>();

function enumerate(k: number, r: number, level: number): Enumeration {
  const key = `${k}/${r}/${level}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const pairs: Array<{ x1: number; x2: number }> = [];
  for (let x1 = 0; x1 <= r; x1++) for (let x2 = 0; x2 <= r; x2++) pairs.push({ x1, x2 });
  const multisets: Multiset[] = [];
  const counts = pairs.map(() => 0);
  const recurse = (index: number, left: number): void => {
    if (index === pairs.length - 1) {
      counts[index] = left;
      const cases: CaseCounts[] = [];
      counts.forEach((c, i) => {
        const o = pairs[i] as { x1: number; x2: number };
        for (let t = 0; t < c; t++)
          cases.push({
            id: `c${cases.length}`,
            candidate: { successes: o.x1, trials: r },
            base: { successes: o.x2, trials: r },
          });
      });
      const { interval, strata } = fixedCasesInterval(cases, level);
      multisets.push({
        counts: [...counts],
        lower: interval.lower,
        regressionP: exactStratifiedTest(strata, "less").p,
      });
      return;
    }
    for (let c = 0; c <= left; c++) {
      counts[index] = c;
      recurse(index + 1, left - c);
    }
  };
  recurse(0, k);
  const result = { k, r, pairs, multisets };
  cache.set(key, result);
  return result;
}

function probability(
  e: Enumeration,
  p: number,
  q: number,
  event: (m: Multiset) => boolean,
): number {
  const pairProb = e.pairs.map((o) => binom(e.r, o.x1, q) * binom(e.r, o.x2, p));
  let total = 0;
  for (const m of e.multisets) {
    if (!event(m)) continue;
    let weight = fact(e.k);
    m.counts.forEach((c, i) => (weight *= (pairProb[i] as number) ** c / fact(c)));
    total += weight;
  }
  return total;
}

/** Exact P(lower ≤ truth) for k cases, r trials per arm, base rate p and candidate rate q. */
export function exactCoverage(k: number, r: number, p: number, q: number, level = 0.95): number {
  return probability(enumerate(k, r, level), p, q, (m) => m.lower <= q - p + 1e-12);
}

/** Exact type-I error of the exact stratified regression test at alpha, every case at rate p. */
export function exactTypeI(k: number, r: number, p: number, alpha = 0.05): number {
  return probability(enumerate(k, r, 0.95), p, p, (m) => m.regressionP <= alpha);
}
