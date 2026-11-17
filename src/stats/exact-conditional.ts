import type { Stratum } from "./score-difference.ts";
import type { TestResult } from "./types.ts";

function logChoose(n: number, k: number): number {
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

const LOG_FACTORIALS: number[] = [0];
function logFactorial(n: number): number {
  for (let i = LOG_FACTORIALS.length; i <= n; i++)
    LOG_FACTORIALS.push((LOG_FACTORIALS[i - 1] as number) + Math.log(i));
  return LOG_FACTORIALS[n] as number;
}

/**
 * Exact stratified conditional test of "no difference in any stratum" (a stratified
 * permutation test of arm labels within cases). Conditional on each stratum's total successes,
 * the candidate's successes are hypergeometric, and their sum has the convolution of those
 * distributions. Returns the one-sided p-value for a lower (`less`) or higher (`greater`)
 * candidate total. Valid at any size; conservative because the statistic is discrete.
 */
export function exactStratifiedTest(
  strata: readonly Stratum[],
  alternative: "less" | "greater",
): TestResult {
  let distribution = [1];
  let observed = 0;
  // A stratum with one feasible count (none or all of its trials succeeded) adds that count to
  // every total: a shift, kept as an offset instead of a convolution with a point mass of exactly 1.
  let offset = 0;
  for (const s of strata) {
    const n1 = s.candidate.trials;
    const n2 = s.base.trials;
    if (n1 === 0 || n2 === 0) continue;
    const total = s.candidate.successes + s.base.successes;
    observed += s.candidate.successes;
    const lo = Math.max(0, total - n2);
    const hi = Math.min(n1, total);
    if (lo === hi) {
      offset += lo;
      continue;
    }
    const denominator = logChoose(n1 + n2, total);
    const pmf: number[] = [];
    for (let k = 0; k <= hi; k++)
      pmf.push(k < lo ? 0 : Math.exp(logChoose(n1, k) + logChoose(n2, total - k) - denominator));
    const next = Array.from({ length: distribution.length + pmf.length - 1 }, () => 0);
    distribution.forEach((a, i) =>
      pmf.forEach((b, j) => (next[i + j] = (next[i + j] as number) + a * b)),
    );
    distribution = next;
  }
  let p = 0;
  distribution.forEach((mass, t) => {
    const candidateTotal = t + offset;
    if (alternative === "less" ? candidateTotal <= observed : candidateTotal >= observed) p += mass;
  });
  return { statistic: observed, p: Math.min(1, p), method: "exact-stratified-conditional" };
}
