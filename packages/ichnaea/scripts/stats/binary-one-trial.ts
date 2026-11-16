// The exact type-I error of the binary regression test with one trial per case and arm: the exact
// stratified conditional test that `compareCounts` runs, which at one trial per arm is the exact
// conditional McNemar test. Only discordant cases carry information: b cases where only the base
// passes, c where only the candidate passes. Given n = b + c, the test rejects at c ≤ c*(n).
import { type CaseCounts, compareCounts, type Rng } from "../../src/stats/index.ts";

export const ALPHA = 0.05;
/**
 * The levels a REGRESSION verdict compares a p-value with: alpha, and alpha / m for Holm across m = 2,
 * 3 and 4 primary measures (the smallest p is compared with alpha / m).
 */
export const LEVELS: readonly number[] = [ALPHA, ALPHA / 2, ALPHA / 3, ALPHA / 4];

/** Per-case pass probabilities under the base and the candidate. */
export type Structure = readonly (readonly [base: number, candidate: number])[];

/** The decision path's regression p-value for n discordant cases, c of them candidate-only. */
export function regressionP(n: number, c: number): number {
  const cases: CaseCounts[] = [
    ...Array.from({ length: c }, (_, i) => ({
      id: `c${i}`,
      candidate: { successes: 1, trials: 1 },
      base: { successes: 0, trials: 1 },
    })),
    ...Array.from({ length: n - c }, (_, i) => ({
      id: `b${i}`,
      candidate: { successes: 0, trials: 1 },
      base: { successes: 1, trials: 1 },
    })),
    // A concordant case changes nothing, and keeps the table non-empty when n = 0.
    { id: "z", candidate: { successes: 1, trials: 1 }, base: { successes: 1, trials: 1 } },
  ];
  return compareCounts({
    estimand: "fixed-cases",
    valueType: "binary",
    cases,
    alpha: ALPHA,
    margin: 0.1,
  }).regressionP;
}

/**
 * c*(n) for n from 0 to maxN: the largest c that the decision path rejects at (p ≤ alpha), or −1.
 * Found by bisection, since the p-value rises with c; both neighbours of each threshold are
 * checked, so a non-monotone p-value would throw.
 */
export function rejectionThresholds(maxN: number, level: number = ALPHA): Int32Array {
  const out = new Int32Array(maxN + 1);
  for (let n = 0; n <= maxN; n++) {
    let lo = -1;
    let hi = n + 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (regressionP(n, mid) <= level) lo = mid;
      else hi = mid;
    }
    if (lo >= 0 && regressionP(n, lo) > level) throw new Error(`n=${n}: not monotone at ${lo}`);
    if (lo + 1 <= n && regressionP(n, lo + 1) <= level)
      throw new Error(`n=${n}: not monotone at ${lo + 1}`);
    out[n] = lo;
  }
  return out;
}

/**
 * The exact probability that the test rejects, by dynamic programming over (n, c): each case is
 * independently candidate-only with probability pC(1 − pB), base-only with pB(1 − pC), and
 * concordant otherwise.
 */
export function exactTypeI(structure: Structure, thresholds: Int32Array): number {
  const k = structure.length;
  if (thresholds.length < k + 1) throw new RangeError("the threshold table is too short");
  // dist[n * (k + 1) + c]
  const width = k + 1;
  let dist = new Float64Array(width * width);
  dist[0] = 1;
  let next = new Float64Array(width * width);
  for (let i = 0; i < k; i++) {
    const [pb, pc] = structure[i] as readonly [number, number];
    const qc = pc * (1 - pb);
    const qb = pb * (1 - pc);
    const stay = 1 - qc - qb;
    next.fill(0);
    for (let n = 0; n <= i; n++) {
      for (let c = 0; c <= n; c++) {
        const mass = dist[n * width + c] as number;
        if (mass === 0) continue;
        next[n * width + c] = (next[n * width + c] as number) + mass * stay;
        next[(n + 1) * width + c + 1] = (next[(n + 1) * width + c + 1] as number) + mass * qc;
        next[(n + 1) * width + c] = (next[(n + 1) * width + c] as number) + mass * qb;
      }
    }
    [dist, next] = [next, dist];
  }
  let p = 0;
  for (let n = 0; n <= k; n++)
    for (let c = 0; c <= (thresholds[n] as number); c++) p += dist[n * width + c] as number;
  return p;
}

/** The rejection probability by enumerating all 4^k outcome pairs through `compareCounts` itself. */
export function bruteForceTypeI(structure: Structure, level: number = ALPHA): number {
  const k = structure.length;
  let p = 0;
  for (let code = 0; code < 4 ** k; code++) {
    let probability = 1;
    const cases: CaseCounts[] = structure.map(([pb, pc], i) => {
      const pair = Math.floor(code / 4 ** i) % 4;
      const cand = pair & 1;
      const base = pair >> 1;
      probability *= (cand ? pc : 1 - pc) * (base ? pb : 1 - pb);
      return {
        id: `c${i}`,
        candidate: { successes: cand, trials: 1 },
        base: { successes: base, trials: 1 },
      };
    });
    if (probability === 0) continue;
    const { regressionP: q } = compareCounts({
      estimand: "fixed-cases",
      valueType: "binary",
      cases,
      alpha: ALPHA,
      margin: 0.1,
    });
    if (q <= level) p += probability;
  }
  return p;
}

const clip = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/**
 * A heterogeneous structure with a mean difference of 0, in the shape that broke the interval
 * (T-4). Family "top": most cases pass the base (always, or nearly) and the candidate drops by dᵢ;
 * 1–3 noisy cases rise to offset it. Family "floor" mirrors it: most cases rise from near 0 and the
 * noisy cases carry the drop, so the long tail of the per-case differences is on the drop side.
 */
export function randomStructure(rng: Rng, k: number, family: "top" | "floor"): Structure {
  for (;;) {
    const noisy = Math.min(k - 1, 1 + Math.floor(rng.uniform() * 3));
    const stable = k - noisy;
    const base = 0.05 + rng.uniform() * 0.9;
    // The noisy cases can offset at most this total, so the mean difference is exactly 0.
    const capacity = noisy * (family === "top" ? 1 - base : base);
    const total = rng.uniform() * capacity;
    // Unequal shares of the total: a larger exponent concentrates it on fewer stable cases.
    const exponent = 0.2 + rng.uniform() * 4;
    const weights = Array.from({ length: stable }, () => rng.uniform() ** exponent);
    const sum = weights.reduce((a, b) => a + b, 0);
    const atEdge = rng.uniform() < 0.5;
    const cases = weights.map((w) => {
      const edge = atEdge ? 0 : rng.uniform() * 0.15;
      const d = (total * w) / sum;
      return family === "top" ? ([1 - edge, 1 - edge - d] as const) : ([edge, edge + d] as const);
    });
    if (cases.some(([, c]) => c < 0 || c > 1)) continue;
    const offset = family === "top" ? total / noisy : -total / noisy;
    return [...cases, ...Array.from({ length: noisy }, () => [base, base + offset] as const)];
  }
}

/**
 * A refinement step: scale the stable effects and move the noisy base, keeping the mean at 0, or
 * undefined when a rate would leave [0, 1]. The noisy cases are the last `noisy` entries.
 */
export function perturb(rng: Rng, s: Structure, noisy: number): Structure | undefined {
  const stable = s.slice(0, s.length - noisy);
  const scale = 0.6 + rng.uniform() * 0.8;
  const moved = stable.map(([b, c]) => [b, b + (c - b) * scale] as const);
  if (moved.some(([, c]) => c < 0 || c > 1)) return undefined;
  const total = moved.reduce((a, [b, c]) => a + c - b, 0);
  const offset = -total / noisy;
  const base = clip(
    (s[s.length - 1] as readonly [number, number])[0] + (rng.uniform() * 2 - 1) * 0.15,
    0,
    1,
  );
  if (base + offset < 0 || base + offset > 1) return undefined;
  return [...moved, ...Array.from({ length: noisy }, () => [base, base + offset] as const)];
}

/** The number of noisy cases of a structure built by `randomStructure` or `perturb`. */
export function noisyCount(s: Structure): number {
  const last = s[s.length - 1] as readonly [number, number];
  let n = 0;
  for (let i = s.length - 1; i >= 0 && n < 3; i--) {
    const [b, c] = s[i] as readonly [number, number];
    if (b !== last[0] || c !== last[1]) break;
    n++;
  }
  return n;
}
