import { critical, pnorm } from "./normal.ts";

/**
 * Kish's design effect of a clustered sample, 1 + (m̃ − 1)ρ, with m̃ = Σm²/Σm the cluster-size
 * weighted mean size. The plain mean size would understate it when sessions differ in size.
 */
export function kishDesignEffect(sizes: readonly number[], rho: number): number {
  if (sizes.length === 0) throw new RangeError("a design effect needs at least one cluster");
  for (const m of sizes)
    if (!(Number.isInteger(m) && m >= 1))
      throw new RangeError(`a cluster size must be a positive integer, got ${m}`);
  if (!(rho >= 0 && rho <= 1)) throw new RangeError(`ρ must be in [0, 1], got ${rho}`);
  const total = sizes.reduce((a, m) => a + m, 0);
  const squares = sizes.reduce((a, m) => a + m * m, 0);
  return 1 + (squares / total - 1) * rho;
}

/**
 * The intraclass correlation ρ of values clustered by session, by one-way ANOVA:
 * (MSB − MSW)/(MSB + (m₀ − 1)·MSW), with m₀ = (N − Σm²/N)/(k − 1). A negative estimate gives 0, so
 * the design effect is never below 1. It needs two clusters and a cluster with two values.
 */
export function intraclassCorrelation(clusters: readonly (readonly number[])[]): number {
  const k = clusters.length;
  const n = clusters.reduce((a, c) => a + c.length, 0);
  if (k < 2 || n <= k || clusters.some((c) => c.length === 0))
    throw new RangeError("ρ needs at least two non-empty clusters and a cluster with two values");
  const grand = clusters.reduce((a, c) => a + c.reduce((x, y) => x + y, 0), 0) / n;
  let between = 0;
  let within = 0;
  for (const c of clusters) {
    const mean = c.reduce((x, y) => x + y, 0) / c.length;
    between += c.length * (mean - grand) ** 2;
    within += c.reduce((a, y) => a + (y - mean) ** 2, 0);
  }
  const msb = between / (k - 1);
  const msw = within / (n - k);
  const m0 = (n - clusters.reduce((a, c) => a + c.length ** 2, 0) / n) / (k - 1);
  const denominator = msb + (m0 - 1) * msw;
  if (denominator <= 0) return 0;
  return Math.min(1, Math.max(0, (msb - msw) / denominator));
}

/**
 * The true rate at which an alert rule on a closed window fires with the given power, under the
 * normal approximation at the effective number of traces n/DEFF. A `below: t` rule fires when the
 * window's upper one-sided bound at `level` is below t, taken as p̂ < t − z·√(t(1 − t)/n_eff). The
 * rate solves P(fire) = power. An `above: t` rule mirrors it. Null when no rate fires that often,
 * because the window is too small. The result is approximate.
 */
export function alertDetectableRate(input: {
  readonly threshold: number;
  readonly rule: "below" | "above";
  readonly traces: number;
  readonly designEffect: number;
  readonly level?: number;
  readonly power?: number;
}): {
  /** The true rate found 4 times in 5, or null when the window is too small. */
  readonly rate: number | null;
  /** n/DEFF. */
  readonly effectiveTraces: number;
  /** Always "approximate": a normal approximation at n_eff. */
  readonly label: "approximate";
} {
  const { threshold, rule, traces, designEffect } = input;
  const level = input.level ?? 0.95;
  const power = input.power ?? 0.8;
  if (!(threshold > 0 && threshold < 1)) throw new RangeError(`the threshold must be in (0, 1)`);
  if (!(traces > 0) || !(designEffect >= 1))
    throw new RangeError("traces must be positive and DEFF at least 1");
  if (!(power > 0.5 && power < 1)) throw new RangeError("the power must be in (0.5, 1)");
  const nEff = traces / designEffect;
  const t = rule === "below" ? threshold : 1 - threshold;
  const sd = (x: number): number => Math.sqrt((x * (1 - x)) / nEff);
  const cut = t - critical(level, "lower") * sd(t);
  if (cut <= 0) return { rate: null, effectiveTraces: nEff, label: "approximate" };
  // P(fire | p) falls from 1 near p = 0 to 0.5 at p = cut, so the root lies in (0, cut).
  const excess = (p: number): number => pnorm((cut - p) / sd(p)) - power;
  if (excess(Number.MIN_VALUE) < 0)
    return { rate: null, effectiveTraces: nEff, label: "approximate" };
  let low = 0;
  let high = cut;
  for (let i = 0; i < 1100; i++) {
    const mid = (low + high) / 2;
    if (mid === low || mid === high) break;
    if (excess(mid) > 0) low = mid;
    else high = mid;
  }
  const rate = (low + high) / 2;
  return { rate: rule === "below" ? rate : 1 - rate, effectiveTraces: nEff, label: "approximate" };
}
