import { critical, pnorm } from "./normal.ts";
import { skewCorrected } from "./score-difference.ts";
import { lowerRoot, upperRoot } from "./solve.ts";
import { assertLevel, type Interval, type Sided, type TestResult } from "./types.ts";

/**
 * A paired 2x2 table of case-level binary outcomes. `candidateOnly` counts cases that pass under
 * the candidate and fail under the base; `baseOnly` the reverse.
 */
export interface PairedTable {
  /** Cases that pass under both arms. */
  readonly both: number;
  /** Cases that pass under the candidate and fail under the base. */
  readonly candidateOnly: number;
  /** Cases that pass under the base and fail under the candidate. */
  readonly baseOnly: number;
  /** Cases that fail under both arms. */
  readonly neither: number;
}

const EDGE = 1e-12;

function checkTable(t: PairedTable): number {
  for (const v of [t.both, t.candidateOnly, t.baseOnly, t.neither]) {
    if (!Number.isInteger(v) || v < 0)
      throw new RangeError(`invalid paired table ${JSON.stringify(t)}`);
  }
  return t.both + t.candidateOnly + t.baseOnly + t.neither;
}

/**
 * Tango's (1998) score statistic for the paired difference, with Laud's skewness correction
 * available. The constrained maximum-likelihood estimate of the base-only cell has a closed form.
 */
function tangoScore(t: PairedTable, skew: boolean): (delta: number) => number {
  const n = checkTable(t);
  const b = t.candidateOnly;
  const c = t.baseOnly;
  return (deltaIn: number): number => {
    const delta = Math.min(1 - EDGE, Math.max(-1 + EDGE, deltaIn));
    const A = 2 * n;
    const B = -b - c + (2 * n - b + c) * delta;
    const C = -c * delta * (1 - delta);
    const q21 = (Math.sqrt(Math.max(B * B - 4 * A * C, 0)) - B) / (2 * A);
    const q12 = q21 + delta;
    const variance = (q12 + q21 - delta * delta) / n;
    const numerator = (b - c) / n - delta;
    if (variance <= 0) return numerator > 0 ? Infinity : numerator < 0 ? -Infinity : 0;
    const score = numerator / Math.sqrt(variance);
    if (!skew) return score;
    // Third central moment of (b - c)/n under the constrained estimates (multinomial cells).
    const mu3 = (q12 - q21 - 3 * delta * (q12 + q21) + 2 * delta ** 3) / (n * n);
    return skewCorrected(score, mu3 / (6 * variance ** 1.5));
  };
}

/** Score interval for the paired difference of proportions, candidate minus base (`sampled-cases`). */
export function tangoInterval(
  table: PairedTable,
  level = 0.95,
  sided: Sided = "two",
  skew = false,
): Interval {
  assertLevel(level);
  const n = checkTable(table);
  const method = skew ? "tango-score-skew" : "tango-score";
  if (n === 0) return { estimate: Number.NaN, lower: -1, upper: 1, level, sided, method };
  const f = tangoScore(table, skew);
  const z = critical(level, sided);
  return {
    estimate: (table.candidateOnly - table.baseOnly) / n,
    lower: sided === "upper" ? -1 : lowerRoot(f, z, -1, 1),
    upper: sided === "lower" ? 1 : upperRoot(f, -z, -1, 1),
    level,
    sided,
    method,
  };
}

/** One-sided Tango score test at a hypothesised difference. */
export function tangoTest(
  table: PairedTable,
  delta0: number,
  alternative: "greater" | "less",
  skew = false,
): TestResult {
  const n = checkTable(table);
  const method = skew ? "tango-score-skew" : "tango-score";
  if (n === 0) return { statistic: 0, p: 1, method };
  const statistic = tangoScore(table, skew)(delta0);
  return {
    statistic,
    p: alternative === "greater" ? pnorm(-statistic) : pnorm(statistic),
    method,
  };
}
