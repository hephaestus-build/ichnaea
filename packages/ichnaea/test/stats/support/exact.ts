// Exact coverage and type-I error for few cases with identical rates, by enumerating every outcome.
// The fixed-cases bound and the exact test depend only on the multiset of per-case outcome pairs, so
// each multiset is evaluated once per (k, r) and reweighted for every pair of rates.
import {
  exactStratifiedTest,
  fixedCasesInterval,
  type CaseCounts,
} from "../../../src/stats/index.ts";

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

/** A group of cases that share rates and trial counts. */
export interface Group {
  readonly count: number;
  readonly base: number;
  readonly candidate: number;
  readonly baseTrials: number;
  readonly candidateTrials: number;
}

interface Outcome {
  readonly x1: number;
  readonly x2: number;
  readonly p: number;
}

/** Every multiset of a group's outcomes with nonzero probability, and its probability. */
function groupMultisets(
  g: Group,
): Array<{ outcomes: Outcome[]; counts: number[]; weight: number }> {
  const outcomes: Outcome[] = [];
  for (let x1 = 0; x1 <= g.candidateTrials; x1++)
    for (let x2 = 0; x2 <= g.baseTrials; x2++) {
      const p = binom(g.candidateTrials, x1, g.candidate) * binom(g.baseTrials, x2, g.base);
      if (p > 0) outcomes.push({ x1, x2, p });
    }
  const result: Array<{ outcomes: Outcome[]; counts: number[]; weight: number }> = [];
  const counts = outcomes.map(() => 0);
  const recurse = (index: number, left: number): void => {
    if (index === outcomes.length - 1) {
      counts[index] = left;
      let weight = fact(g.count);
      counts.forEach((c, i) => (weight *= (outcomes[i] as Outcome).p ** c / fact(c)));
      result.push({ outcomes, counts: [...counts], weight });
      return;
    }
    for (let c = 0; c <= left; c++) {
      counts[index] = c;
      recurse(index + 1, left - c);
    }
  };
  recurse(0, g.count);
  return result;
}

/** The true mean of per-case differences over the groups. */
export function truthOfGroups(groups: readonly Group[]): number {
  const k = groups.reduce((a, g) => a + g.count, 0);
  return groups.reduce((a, g) => a + g.count * (g.candidate - g.base), 0) / k;
}

/**
 * The exact probability of an event over every outcome of the groups' cases. The event sees the
 * cases in group order; the methods under test do not depend on case order.
 */
export function exactGroups(
  groups: readonly Group[],
  event: (cases: CaseCounts[]) => boolean,
): number {
  const perGroup = groups.map(groupMultisets);
  let total = 0;
  const chosen: Array<{ outcomes: Outcome[]; counts: number[]; weight: number }> = [];
  const recurse = (index: number, weight: number): void => {
    if (index === groups.length) {
      const cases: CaseCounts[] = [];
      chosen.forEach((m, gi) => {
        const g = groups[gi] as Group;
        m.counts.forEach((c, i) => {
          const o = m.outcomes[i] as Outcome;
          for (let t = 0; t < c; t++)
            cases.push({
              id: `c${String(cases.length).padStart(3, "0")}`,
              candidate: { successes: o.x1, trials: g.candidateTrials },
              base: { successes: o.x2, trials: g.baseTrials },
            });
        });
      });
      if (event(cases)) total += weight;
      return;
    }
    for (const m of perGroup[index] as typeof chosen) {
      chosen[index] = m;
      recurse(index + 1, weight * m.weight);
    }
  };
  recurse(0, 1);
  return total;
}

/** Exact coverage of the fixed-cases lower bound over groups. */
export function exactGroupCoverage(groups: readonly Group[], level = 0.95): number {
  const truth = truthOfGroups(groups);
  return exactGroups(
    groups,
    (cases) => fixedCasesInterval(cases, level).interval.lower <= truth + 1e-12,
  );
}

/** Cases that share their trial counts. */
export interface Pattern {
  readonly count: number;
  readonly candidateTrials: number;
  readonly baseTrials: number;
}

interface PatternEnumeration {
  readonly perGroup: ReadonlyArray<ReadonlyArray<{ x1: number; x2: number }>>;
  /** Per combination: the count of each outcome type in each group, and the lower bound. */
  readonly combos: ReadonlyArray<{ counts: readonly (readonly number[])[]; lower: number }>;
}

const patternCache = new Map<string, PatternEnumeration>();

function enumeratePatterns(patterns: readonly Pattern[], level: number): PatternEnumeration {
  const key = `${JSON.stringify(patterns)}/${level}`;
  const cached = patternCache.get(key);
  if (cached) return cached;
  const perGroup = patterns.map((g) => {
    const types: Array<{ x1: number; x2: number }> = [];
    for (let x1 = 0; x1 <= g.candidateTrials; x1++)
      for (let x2 = 0; x2 <= g.baseTrials; x2++) types.push({ x1, x2 });
    return types;
  });
  const multisets = patterns.map((g, gi) => {
    const types = perGroup[gi] as Array<{ x1: number; x2: number }>;
    const out: number[][] = [];
    const counts = types.map(() => 0);
    const recurse = (index: number, left: number): void => {
      if (index === types.length - 1) {
        counts[index] = left;
        out.push([...counts]);
        return;
      }
      for (let c = 0; c <= left; c++) {
        counts[index] = c;
        recurse(index + 1, left - c);
      }
    };
    recurse(0, g.count);
    return out;
  });
  const combos: Array<{ counts: number[][]; lower: number }> = [];
  const chosen: number[][] = [];
  const recurse = (gi: number): void => {
    if (gi === patterns.length) {
      const cases: CaseCounts[] = [];
      chosen.forEach((counts, g) => {
        const pattern = patterns[g] as Pattern;
        counts.forEach((c, i) => {
          const o = (perGroup[g] as Array<{ x1: number; x2: number }>)[i] as {
            x1: number;
            x2: number;
          };
          for (let t = 0; t < c; t++)
            cases.push({
              id: `c${String(cases.length).padStart(3, "0")}`,
              candidate: { successes: o.x1, trials: pattern.candidateTrials },
              base: { successes: o.x2, trials: pattern.baseTrials },
            });
        });
      });
      combos.push({
        counts: chosen.map((c) => [...c]),
        lower: fixedCasesInterval(cases, level).interval.lower,
      });
      return;
    }
    for (const m of multisets[gi] as number[][]) {
      chosen[gi] = m;
      recurse(gi + 1);
    }
  };
  recurse(0);
  const result = { perGroup, combos };
  patternCache.set(key, result);
  return result;
}

/**
 * Exact coverage of the fixed-cases lower bound when every case has base rate p and candidate rate
 * q, but cases differ in their trial counts. Each bound is computed once per pattern and reweighted
 * for every pair of rates.
 */
export function exactPatternCoverage(
  patterns: readonly Pattern[],
  p: number,
  q: number,
  level = 0.95,
): number {
  const e = enumeratePatterns(patterns, level);
  const typeProb = patterns.map((g, gi) =>
    (e.perGroup[gi] as Array<{ x1: number; x2: number }>).map(
      (o) => binom(g.candidateTrials, o.x1, q) * binom(g.baseTrials, o.x2, p),
    ),
  );
  let total = 0;
  for (const combo of e.combos) {
    if (combo.lower > q - p + 1e-12) continue;
    let weight = 1;
    combo.counts.forEach((counts, gi) => {
      weight *= fact((patterns[gi] as Pattern).count);
      counts.forEach(
        (c, i) => (weight *= ((typeProb[gi] as number[])[i] as number) ** c / fact(c)),
      );
    });
    total += weight;
  }
  return total;
}
