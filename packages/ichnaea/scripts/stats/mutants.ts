// Manual mutation testing of the statistics until StrykerJS runs at 1.0 (REQ-112). Each mutant is
// one source change that a test must detect. Run in a scratch copy, never in a working tree:
//   node scripts/stats/mutants.ts            # every mutant
//   node scripts/stats/mutants.ts "level"     # selected mutants
// A mutant that survives is a test that cannot fail: kill it, or justify it as equivalent here.
// Only an assertion failure kills. A mutant under which a test throws any other error, or a suite
// does not load, is a run error, not a kill, and the run fails. A test that times out detects the
// mutant, and more than a tenth of such timeouts fail the run. Every run first
// applies a comment-only canary that must survive and a deliberate break that must be killed, and
// a run with no mutant selected fails: scripts/mutation.ts.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type Outcome, runMutations, runTests } from "../mutation.ts";

export interface Mutant {
  readonly id: string;
  readonly file: string;
  readonly from: string;
  readonly to: string;
  /** Regenerate schemas and fixtures first, as a schema change would. */
  readonly regen?: boolean;
}

/**
 * The canary: a change to a comment, which no test can detect. It runs first and must survive. A
 * killed canary means some test fails whatever the mutant does, and then every kill is vacuous.
 */
export const CANARY: Mutant = {
  id: "canary: a comment only",
  file: "src/stats/types.ts",
  from: "/** Successes out of trials. */",
  to: "/** Successes out of trials (the mutation canary). */",
};

/**
 * The control: a deliberate break of the Wilson centre, which the reference values assert. It runs
 * second and must be killed; otherwise this run cannot show a kill.
 */
export const CONTROL: Mutant = {
  id: "control: the Wilson centre broken",
  file: "src/stats/wilson.ts",
  from: "const centre = (p + z2 / (2 * n)) / (1 + z2 / n);",
  to: "const centre = (p + z2 / (3 * n)) / (1 + z2 / n);",
};

export const MUTANTS: readonly Mutant[] = [
  {
    id: "fidelity: score variance without the correction",
    file: "src/stats/fidelity.ts",
    from: "squares(v) / (v.length - 1) / v.length;",
    to: "squares(v) / v.length / v.length;",
  },
  {
    id: "estimate: restricted difference takes a trial censored below L",
    file: "src/stats/censoring.ts",
    from: "if (d.censored && d.time < limit)",
    to: "if (d.censored && d.time < 0)",
  },
  {
    id: "fidelity: pooled within-cell variance",
    file: "src/stats/fidelity.ts",
    from: "a + cellVariance(c.replayed) + cellVariance(c.recorded), 0)",
    to: "a + cases.reduce((s, x) => s + squares(x.replayed), 0) / cases.reduce((s, x) => s + x.replayed.length - 1, 0) / c.replayed.length + cases.reduce((s, x) => s + squares(x.recorded), 0) / cases.reduce((s, x) => s + x.recorded.length - 1, 0) / c.recorded.length, 0)",
  },
  {
    id: "fidelity: the sum of squares about a mean taken first",
    file: "src/stats/fidelity.ts",
    from: "const d = v.map((y) => y - v[0]!);\n  return Math.max(0, d.reduce((a, x) => a + x * x, 0) - sum(d) ** 2 / v.length);",
    to: "const mean = sum(v) / v.length;\n  return v.reduce((a, y) => a + (y - mean) ** 2, 0);",
  },
  {
    id: "fidelity: shown at the 95% level",
    file: "src/stats/fidelity.ts",
    from: 'critical(0.9, "two")',
    to: 'critical(0.95, "two")',
  },
  {
    id: "fidelity: one-sided margin",
    file: "src/stats/fidelity.ts",
    from: "shown: interval.lower > -margin && interval.upper < margin,",
    to: "shown: interval.upper < margin,",
  },
  {
    id: "alert: design effect from the plain mean size",
    file: "src/stats/alert.ts",
    from: "return 1 + (squares / total - 1) * rho;",
    to: "return 1 + (total / sizes.length - 1) * rho;",
  },
  {
    id: "alert: ρ with m₀ in place of m₀ − 1",
    file: "src/stats/alert.ts",
    from: "const denominator = msb + (m0 - 1) * msw;",
    to: "const denominator = msb + m0 * msw;",
  },
  {
    id: "alert: power ignores the design effect",
    file: "src/stats/alert.ts",
    from: "const nEff = traces / designEffect;",
    to: "const nEff = traces;",
  },
  {
    id: "alert: the level unchecked",
    file: "src/stats/alert.ts",
    from: 'if (!(level > 0.5 && level < 1)) throw new RangeError("the level must be in (0.5, 1)");',
    to: 'if (!(level > 0 && level < 1)) throw new RangeError("the level must be in (0, 1)");',
  },
  {
    id: "never: no split of the level",
    file: "src/stats/never.ts",
    from: 'detector.kind === "model" ? 1 - (1 - confidence) / 2 : confidence;',
    to: "confidence;",
  },
  {
    id: "never: sensitivity multiplies the bound",
    file: "src/stats/never.ts",
    from: "Math.min(1, flagged / sensitivity)",
    to: "Math.min(1, flagged * sensitivity)",
  },
  {
    id: "never: flagged-only at the split level",
    file: "src/stats/never.ts",
    from: '      confidence,\n      "upper",\n    );',
    to: '      0.975,\n      "upper",\n    );',
  },
  {
    id: "never: planning claim one case short",
    file: "src/stats/never.ts",
    from: "1 - tail ** (1 / k) <= target",
    to: "1 - tail ** (1 / (k + 1)) <= target",
  },
  {
    id: "never: planning count unadjusted",
    file: "src/stats/never.ts",
    from: 'const tail = adjustedTail(boundLevel(confidence, detector), "upper");',
    to: "const tail = 1 - boundLevel(confidence, detector);",
  },
  {
    id: "never: planning count without the 1/4 restriction",
    file: "src/stats/never.ts",
    from: 'const tail = adjustedTail(boundLevel(confidence, detector), "upper");',
    to: "const tail = 1 - Math.exp(-(1 - boundLevel(confidence, detector)));",
  },
  {
    id: "never: an unrepresentable planning count returned",
    file: "src/stats/never.ts",
    from: "if (!(Number.isSafeInteger(high) && high - low === 1))",
    to: "if (Number.isNaN(high))",
  },
  {
    id: "overdispersion: variance without n − 1",
    file: "src/stats/overdispersion.ts",
    from: "(n * n * (n - 1))",
    to: "(n * n * n)",
  },
  {
    id: "overdispersion: interval tails swapped",
    file: "src/stats/overdispersion.ts",
    from: "lower: sum / chiSquareQuantile(1 - tail, n),",
    to: "lower: sum / chiSquareQuantile(tail, n),",
  },
  {
    id: "overdispersion: a run with V = 0 kept",
    file: "src/stats/overdispersion.ts",
    from: "return variance > 0 ?",
    to: "return variance >= 0 ?",
  },
  {
    id: "overdispersion: χ² at twice the degrees of freedom",
    file: "src/stats/chi-square.ts",
    from: "regularizedGammaP(df / 2, x / 2)",
    to: "regularizedGammaP(df, x / 2)",
  },
  {
    id: "overdispersion: χ² upper quantile from 1 − P",
    file: "src/stats/chi-square.ts",
    from: "regularizedGammaQ(df / 2, x / 2) > 1 - p",
    to: "1 - regularizedGammaP(df / 2, x / 2) > 1 - p",
  },
  {
    id: "overdispersion: upper incomplete gamma from 1 − P",
    file: "src/stats/beta.ts",
    from: ": Math.min(1, upperFraction(a, x, front));",
    to: ": Math.max(0, 1 - Math.max(0, 1 - upperFraction(a, x, front)));",
  },
  {
    id: "estimate: Clopper–Pearson tail not split",
    file: "src/stats/clopper-pearson.ts",
    from: 'const tail = sided === "two" ? (1 - level) / 2 : 1 - level;',
    to: "const tail = 1 - level;",
  },
  {
    id: "estimate: Clopper–Pearson lower beta shape",
    file: "src/stats/clopper-pearson.ts",
    from: "incompleteBeta(p, x, n - x + 1)",
    to: "incompleteBeta(p, x, n - x)",
  },
  {
    id: "estimate: Clopper–Pearson closed form at zero",
    file: "src/stats/clopper-pearson.ts",
    from: "x === 0 ? 1 - tail ** (1 / n)",
    to: "x === 0 ? 1 - tail ** (1 / (n + 1))",
  },
  {
    id: "estimate: Hoeffding two sides at ln(1/α)",
    file: "src/stats/hoeffding.ts",
    from: '(sided === "two" ? 2 : 1) / alpha',
    to: "1 / alpha",
  },
  {
    id: "estimate: Hoeffding without the half",
    file: "src/stats/hoeffding.ts",
    from: "* squares) / 2);",
    to: "* squares));",
  },
  {
    id: "estimate: one-arm score weight not squared",
    file: "src/stats/one-arm-score.ts",
    from: "cells[i]!.weight ** 2 * p * (1 - p)",
    to: "cells[i]!.weight * p * (1 - p)",
  },
  {
    id: "estimate: one-arm score upper bound not reflected",
    file: "src/stats/one-arm-score.ts",
    from: "1 - lowerBound(flipped, 1 - estimate, target)",
    to: "1 - lowerBound(flipped, estimate, target)",
  },
  {
    id: "estimate: unequal weights take the binomial path",
    file: "src/stats/estimate.ts",
    from: "if (!allEqual(weights)) {",
    to: "if (allEqual(weights)) {",
  },
  {
    id: "estimate: one-trial path on any case with one trial",
    file: "src/stats/estimate.ts",
    from: "if (observed.every((c) => c.trials === 1)) {",
    to: "if (observed.some((c) => c.trials === 1)) {",
  },
  {
    id: "estimate: Wilson on one case fewer",
    file: "src/stats/estimate.ts",
    from: "wilsonMean(point, observed.length, level, sided)",
    to: "wilsonMean(point, observed.length - 1, level, sided)",
  },
  {
    id: "estimate: worst case high ignores missing trials",
    file: "src/stats/estimate.ts",
    from: "(c.sum + c.planned - c.trials)",
    to: "(c.sum)",
  },
  {
    id: "estimate: operational Clopper–Pearson for scores",
    file: "src/stats/estimate.ts",
    from: 'if (input.valueType === "binary" && allEqual(trialWeights)) {',
    to: "if (allEqual(trialWeights)) {",
  },
  {
    id: "estimate: population from 29 clusters",
    file: "src/stats/estimate.ts",
    from: "export const POPULATION_MIN_CLUSTERS = 30;",
    to: "export const POPULATION_MIN_CLUSTERS = 29;",
  },
  {
    id: "estimate: BCa ties count as not below",
    file: "src/stats/bca.ts",
    from: "const share = (below + 0.5 * ties) / resamples;",
    to: "const share = below / resamples;",
  },
  {
    id: "estimate: BCa acceleration sign",
    file: "src/stats/bca.ts",
    from: "const d = centre - value;",
    to: "const d = value - centre;",
  },
  {
    id: "estimate: pass^k over k − 1",
    file: "src/stats/reduce.ts",
    from: "? chooseRatio(c, r, k)",
    to: "? chooseRatio(c, r, k - 1)",
  },
  {
    id: "estimate: pass@k over r − 1",
    file: "src/stats/reduce.ts",
    from: "1 - chooseRatio(r - c, r, k)",
    to: "1 - chooseRatio(r - c, r - 1, k)",
  },
  {
    id: "estimate: majority tie always fails",
    file: "src/stats/reduce.ts",
    from: 'reduction.majority.tie === "pass" ? 1 : 0',
    to: "0",
  },
  {
    id: "estimate: Kaplan–Meier counts a censored trial as an event",
    file: "src/stats/censoring.ts",
    from: "if (!sorted[i]!.censored) events += w;",
    to: "events += w;",
  },
  {
    id: "estimate: survival quantile at the plateau's start",
    file: "src/stats/censoring.ts",
    from: "next ? { value: (step.time + next.time) / 2 } : { atLeast: step.time };",
    to: "next ? { value: step.time } : { atLeast: step.time };",
  },
  {
    id: "estimate: restricted mean stops at the last event",
    file: "src/stats/censoring.ts",
    from: "return area + survival * (limit - last);",
    to: "return area;",
  },
  {
    id: "estimate: missing-count test one-sided",
    file: "src/stats/missingness.ts",
    from: "p: Math.min(1, 2 * Math.min(less, greater)),",
    to: "p: Math.min(less, greater),",
  },
  {
    id: "NI null at +margin",
    file: "src/stats/compare.ts",
    from: 'scoreDifferenceTest(strata, -input.margin, "greater", options)',
    to: 'scoreDifferenceTest(strata, input.margin, "greater", options)',
  },
  {
    id: "regression tail (fixed-cases)",
    file: "src/stats/compare.ts",
    from: 'regressionTest = exactStratifiedTest(strata, "less");',
    to: 'regressionTest = exactStratifiedTest(strata, "greater");',
  },
  {
    id: "regression tail (Tango)",
    file: "src/stats/compare.ts",
    from: 'const regressionTest = tangoTest(table, 0, "less", true);',
    to: 'const regressionTest = tangoTest(table, 0, "greater", true);',
  },
  {
    id: "score test tails swapped",
    file: "src/stats/score-difference.ts",
    from: 'alternative === "greater" ? pnorm(-statistic) : pnorm(statistic)',
    to: 'alternative === "greater" ? pnorm(statistic) : pnorm(-statistic)',
  },
  {
    id: "level 1 - 2 alpha",
    file: "src/stats/compare.ts",
    from: "const level = 1 - input.alpha;",
    to: "const level = 1 - 2 * input.alpha;",
  },
  {
    id: "MDE quantile off by one",
    file: "src/stats/power.ts",
    from: "Math.ceil(q * sorted.length) - 1",
    to: "Math.ceil(q * sorted.length)",
  },
  {
    id: "floor default alpha 0.025",
    file: "src/stats/power.ts",
    from: "  replicates: number,\n  alpha = 0.05,",
    to: "  replicates: number,\n  alpha = 0.025,",
  },
  {
    id: "floor default alpha 0.025 (per-case trials)",
    file: "src/stats/power.ts",
    from: "  trials: readonly number[],\n  alpha = 0.05,",
    to: "  trials: readonly number[],\n  alpha = 0.025,",
  },
  {
    id: "res53 wrong shift",
    file: "src/stats/rng.ts",
    from: "(next() >>> 5) * 67108864",
    to: "(next() >>> 4) * 67108864",
  },
  {
    id: "N/(N-1) default dropped",
    file: "src/stats/score-difference.ts",
    from: "number {\n  const bias = options.biasCorrection ?? true;",
    to: "number {\n  const bias = options.biasCorrection ?? false;",
  },
  {
    id: "Mantel-Haenszel weights for fixed-cases",
    file: "src/stats/compare.ts",
    from: 'weights: "equal" };',
    to: 'weights: "mantel-haenszel" };',
  },
  {
    id: "unstable skew root",
    file: "src/stats/score-difference.ts",
    from: "return (2 * (score + c)) / (1 + Math.sqrt(discriminant));",
    to: "return (-1 + Math.sqrt(discriminant)) / (2 * c);",
  },
  {
    id: "validated everywhere",
    file: "src/stats/compare.ts",
    from: "  validated: limitations.length === 0,",
    to: "  validated: true,",
  },
  {
    id: "exact test counts ties out",
    file: "src/stats/exact-conditional.ts",
    from: 'alternative === "less" ? candidateTotal <= observed : candidateTotal >= observed',
    to: 'alternative === "less" ? candidateTotal < observed : candidateTotal > observed',
  },
  // Mutants that survived a review, and the missing-trial rules (decision 0009).
  {
    id: "M40 permutation wrong tail",
    file: "src/stats/randomisation.ts",
    from: "if (statistic(x1) <= observed + tolerance) extreme++;",
    to: "if (statistic(x1) >= observed - tolerance) extreme++;",
  },
  {
    id: "M41 permutation p without +1",
    file: "src/stats/randomisation.ts",
    from: "p: (1 + extreme) / (1 + resamples),",
    to: "p: extreme / resamples,",
  },
  {
    id: "M42 permutation with replacement",
    file: "src/stats/randomisation.ts",
    from: "      picked++;\n      good--;\n    }\n    left--;",
    to: "      picked++;\n    }",
  },
  {
    id: "M43 permutation base rate over candidate trials",
    file: "src/stats/randomisation.ts",
    from: "(s.candidate.successes + s.base.successes - (x1[i] as number)) / s.base.trials,",
    to: "(s.candidate.successes + s.base.successes - (x1[i] as number)) / s.candidate.trials,",
  },
  {
    id: "M44 Tango from 30 cases",
    file: "src/stats/compare.ts",
    from: "export const SAMPLED_CASES_MIN_CASES = 300;",
    to: "export const SAMPLED_CASES_MIN_CASES = 30;",
  },
  {
    id: "M45 skew no-root returns infinity",
    file: "src/stats/score-difference.ts",
    from: "if (discriminant < 0) return score;",
    to: "if (discriminant < 0) return score > 0 ? Infinity : -Infinity;",
  },
  {
    id: "M36 sampled-cases floor at alpha/2",
    file: "src/stats/power.ts",
    from: '    1 - alpha,\n    "lower",\n    true,',
    to: '    1 - alpha / 2,\n    "lower",\n    true,',
  },
  {
    id: "missing trials: cases with one trial dropped",
    file: "src/stats/compare.ts",
    from: "    .filter((c) => c.base.trials > 0 && c.candidate.trials > 0)\n    .map(",
    to: "    .filter((c) => c.base.trials > 1 && c.candidate.trials > 1)\n    .map(",
  },
  {
    id: "missing trials: gate from 3 cases",
    file: "src/stats/compare.ts",
    from: "  minCases: 5,",
    to: "  minCases: 3,",
  },
  {
    id: "missing trials: excluded cases still validated",
    file: "src/stats/compare.ts",
    from: "      ...(excludedCases > 0 && checks === undefined\n",
    to: "      ...(false\n",
  },
  {
    id: "missing trials: more than 3 trials validated",
    file: "src/stats/compare.ts",
    from: "  maxTrials: 3,",
    to: "  maxTrials: 4,",
  },
  {
    id: "missing trials: sparse cells validated",
    file: "src/stats/compare.ts",
    from: "  minShareWithTwoTrials: 0.9,",
    to: "  minShareWithTwoTrials: 0.8,",
  },
  {
    id: "missing trials: sampled-cases families ignored",
    file: "src/stats/compare.ts",
    from: "families.size !== used.length || ",
    to: "false || ",
  },
  {
    id: "unequal counts sent to the exact test",
    file: "src/stats/compare.ts",
    from: "const balanced = new Set(cells).size === 1;",
    to: "const balanced = true;",
  },
  {
    id: "pnorm central coefficient typo",
    file: "src/stats/normal-coefficients.ts",
    from: "161.02823106855587",
    to: "161.02832106855587",
  },
  {
    id: "pnorm tail coefficient typo",
    file: "src/stats/normal-coefficients.ts",
    from: "0.023073441764940174",
    to: "0.023073414764940174",
  },
  {
    id: "pnorm square not split",
    file: "src/stats/normal.ts",
    from: "Math.trunc(x * SPLIT) / SPLIT",
    to: "x",
  },
  {
    id: "pnorm branch boundary moved",
    file: "src/stats/normal-coefficients.ts",
    from: "central: 0.67448975",
    to: "central: 0.5",
  },
  {
    id: "pnorm branch boundary typo",
    file: "src/stats/normal-coefficients.ts",
    from: "central: 0.67448975",
    to: "central: 0.067448975",
  },
  {
    id: "qnorm central coefficient typo",
    file: "src/stats/normal-coefficients.ts",
    from: "13731.69376550946",
    to: "13731.69367550946",
  },
  {
    id: "qnorm far-tail coefficient typo",
    file: "src/stats/normal-coefficients.ts",
    from: "0.014875361290850615",
    to: "0.014875316290850615",
  },
  {
    id: "qnorm central denominator typo",
    file: "src/stats/normal-coefficients.ts",
    from: "5226.495278852854",
    to: "5226.495278852546",
  },
  {
    id: "pnorm tail bound of R 4.4",
    file: "src/stats/normal-coefficients.ts",
    from: "lowerTail: -38.4674",
    to: "lowerTail: -37.5193",
  },
  {
    id: "qnorm subnormal p on the far rational",
    file: "src/stats/normal-coefficients.ts",
    from: "far: 27",
    to: "far: 30",
  },
  // Not a mutant: changing the fifth-order term of qnorm's asymptotic expansion, (5 - 9 / (8 + x2))
  // to (5 - 9 / (6 + x2)), moves the result by at most 0.84 ε·|v|, on 1 % of 2,000,000 subnormal p.
  // That is below rounding, so no reference value can detect it.
  {
    id: "pnorm small-x cutoff",
    file: "src/stats/normal.ts",
    from: "const HALF_EPSILON = Number.EPSILON / 2;",
    to: "const HALF_EPSILON = 1e-3;",
  },
  {
    id: "pnorm tail cutoff too early",
    file: "src/stats/normal-coefficients.ts",
    from: "lowerTail: -38.4674",
    to: "lowerTail: -38.2",
  },
  {
    id: "pnorm second boundary lower",
    file: "src/stats/normal.ts",
    from: "const SQRT_32 = 5.656854249492381;",
    to: "const SQRT_32 = 5.5;",
  },
  {
    id: "pnorm second boundary higher",
    file: "src/stats/normal.ts",
    from: "const SQRT_32 = 5.656854249492381;",
    to: "const SQRT_32 = 6;",
  },
  {
    id: "pnorm first boundary higher",
    file: "src/stats/normal-coefficients.ts",
    from: "central: 0.67448975",
    to: "central: 0.8",
  },
  {
    id: "pnorm square split coarser",
    file: "src/stats/normal-coefficients.ts",
    from: "splitExponent: 4",
    to: "splitExponent: 3",
  },
  {
    id: "qnorm central boundary lower",
    file: "src/stats/normal-coefficients.ts",
    from: "central: 0.425",
    to: "central: 0.42",
  },
  {
    id: "rule: confirmed coverage threshold 0.93",
    file: "test/stats/support/simulate.ts",
    from: "c + 3 * s < 0.94",
    to: "c + 3 * s < 0.93",
  },
  {
    id: "rule: confirmed coverage allowance 10\u00b7SE",
    file: "test/stats/support/simulate.ts",
    from: "c + 3 * s < 0.94",
    to: "c + 10 * s < 0.94",
  },
  {
    id: "rule: coverage screen at 0.94 \u2212 2\u00b7SE",
    file: "test/stats/support/simulate.ts",
    from: "clears: (c, s) => c >= 0.94 + 2 * s",
    to: "clears: (c, s) => c >= 0.94 - 2 * s",
  },
  {
    id: "rule: exact coverage threshold 0.93",
    file: "test/stats/support/simulate.ts",
    from: "e.value < 0.94 : e.value > 0.05",
    to: "e.value < 0.93 : e.value > 0.05",
  },
  {
    id: "rule: exact type-I threshold 0.06",
    file: "test/stats/support/simulate.ts",
    from: "e.value < 0.94 : e.value > 0.05",
    to: "e.value < 0.94 : e.value > 0.06",
  },
  {
    id: "rule: no grid-mean rule",
    file: "test/stats/support/simulate.ts",
    from: "if (mean + 3 * meanSe < rule.nominal)",
    to: "if (mean + 3 * meanSe < 0)",
  },
  {
    id: "rule: grid-mean allowance 6\u00b7SE",
    file: "test/stats/support/simulate.ts",
    from: "if (mean + 3 * meanSe < rule.nominal)",
    to: "if (mean + 6 * meanSe < rule.nominal)",
  },
  {
    id: "rule: grid-mean SEs added linearly",
    file: "test/stats/support/simulate.ts",
    from: "Math.sqrt(estimates.reduce((a, e) => a + e.se ** 2, 0)) / estimates.length",
    to: "estimates.reduce((a, e) => a + e.se, 0) / estimates.length",
  },
  {
    id: "rule: exact coverage cut at 0.9399 or less",
    file: "test/stats/support/simulate.ts",
    from: "e.value < 0.94 : e.value > 0.05",
    to: "e.value <= 0.9399 : e.value > 0.05",
  },
  {
    id: "rule: confirmed type-I threshold 0.07",
    file: "test/stats/support/simulate.ts",
    from: "fails: (p, s) => p - 3 * s > 0.05",
    to: "fails: (p, s) => p - 3 * s > 0.07",
  },
  {
    id: "rule: type-I screen at 0.05 + 2\u00b7SE",
    file: "test/stats/support/simulate.ts",
    from: "clears: (p, s) => p <= 0.05 - 2 * s",
    to: "clears: (p, s) => p <= 0.05 + 2 * s",
  },
  {
    id: "rule: confirmation to SE 0.003",
    file: "test/stats/support/simulate.ts",
    from: "export const CONFIRM_SE = 0.0005;",
    to: "export const CONFIRM_SE = 0.003;",
  },
  {
    id: "rule: one confirmation batch",
    file: "test/stats/support/simulate.ts",
    from: "} while (se(hits / reps, reps) > CONFIRM_SE);",
    to: "} while (false);",
  },
  {
    id: "rule: confirmation reuses the screening seed",
    file: "test/stats/support/simulate.ts",
    from: "createRng(point.seed + CONFIRM_SEED_OFFSET)",
    to: "createRng(point.seed)",
  },
  {
    id: "rule: candidate cap on type-I grids",
    file: "test/stats/support/simulate.ts",
    from: 'rule.kind === "coverage" && candidates.length > MAX_CANDIDATES',
    to: "candidates.length > MAX_CANDIDATES",
  },
  {
    id: "rule: no candidate cap on coverage grids",
    file: "test/stats/support/simulate.ts",
    from: 'rule.kind === "coverage" && candidates.length > MAX_CANDIDATES',
    to: "false && candidates.length > MAX_CANDIDATES",
  },
  {
    id: "source: edge clamp 1e-3",
    file: "src/stats/score-difference.ts",
    from: "const EDGE = 1e-12;",
    to: "const EDGE = 1e-3;",
  },
  {
    id: "source: exact test lower support with unequal arms",
    file: "src/stats/exact-conditional.ts",
    from: "const lo = Math.max(0, total - n2);",
    to: "const lo = Math.max(0, total - n1);",
  },
  {
    id: "source: exact test upper support with unequal arms",
    file: "src/stats/exact-conditional.ts",
    from: "const hi = Math.min(n1, total);",
    to: "const hi = Math.min(n2, total);",
  },
  {
    id: "source: input order decides",
    file: "src/stats/compare.ts",
    from: "const ordered = input.cases.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));",
    to: "const ordered = [...input.cases];",
  },
  {
    id: "source: floor weights by Mantel\u2013Haenszel",
    file: "src/stats/power.ts",
    from: '{ weights: "equal", ...options }',
    to: '{ weights: "mantel-haenszel", ...options }',
  },
  {
    id: "source: margin 1 accepted",
    file: "src/stats/compare.ts",
    from: "input.margin >= 0 && input.margin < 1",
    to: "input.margin >= 0 && input.margin <= 1",
  },
  {
    id: "source: negative margin accepted",
    file: "src/stats/compare.ts",
    from: "input.margin >= 0 && input.margin < 1",
    to: "input.margin >= -1 && input.margin < 1",
  },
  {
    id: "source: missing generator falls back to the exact test",
    file: "src/stats/compare.ts",
    from: "      if (!input.rng)\n        throw new EstimandError(",
    to: "      if (!input.rng) return compareCounts({ ...input, cases: input.cases.map((c) => ({ ...c, base: { ...c.base, trials: c.candidate.trials, successes: Math.min(c.base.successes, c.candidate.trials) } })) });\n      if (!input.rng)\n        throw new EstimandError(",
  },
  {
    id: "source: a proportion passes as counts",
    file: "src/stats/compare.ts",
    from: 'if (input.valueType !== "binary")',
    to: 'if (input.valueType === "score")',
  },
  {
    id: "source: margin ceiling 1",
    file: "src/stats/compare.ts",
    from: "export const VALIDATED_MARGIN_CEILING = 0.3;",
    to: "export const VALIDATED_MARGIN_CEILING = 1;",
  },
  {
    id: "source: the margin floor counts as set",
    file: "src/stats/compare.ts",
    from: "export const VALIDATED_MARGIN_FLOOR_SET = false;",
    to: "export const VALIDATED_MARGIN_FLOOR_SET = true;",
  },
  {
    id: "source: the floor-not-set reason dropped",
    file: "src/stats/compare.ts",
    from: "...(VALIDATED_MARGIN_FLOOR_SET ? [] : [MARGIN_FLOOR_NOT_SET]),",
    to: "...([] as string[]),",
  },
  {
    id: "source: regression depends on the margin",
    file: "src/stats/compare.ts",
    from: "regression: validity(domainLimitations),",
    to: "regression: validity([...domainLimitations, ...marginLimitations]),",
  },
  {
    id: "source: non-inferiority ignores the domain",
    file: "src/stats/compare.ts",
    from: "      nonInferiority: validity([\n        ...domainLimitations,\n        ...marginLimitations,",
    to: "      nonInferiority: validity([\n        ...marginLimitations,",
  },
  {
    id: "source: sampled-cases regression validated",
    file: "src/stats/compare.ts",
    from: "    regression: validity(experimental),",
    to: "    regression: validity([]),",
  },
  {
    id: "source: margin floor 0",
    file: "src/stats/compare.ts",
    from: "export const VALIDATED_MARGIN_FLOOR = 0.05;",
    to: "export const VALIDATED_MARGIN_FLOOR = 0;",
  },
  {
    id: "source: margin floor 0.06",
    file: "src/stats/compare.ts",
    from: "export const VALIDATED_MARGIN_FLOOR = 0.05;",
    to: "export const VALIDATED_MARGIN_FLOOR = 0.06;",
  },
  {
    id: "source: margin floor 0.04",
    file: "src/stats/compare.ts",
    from: "export const VALIDATED_MARGIN_FLOOR = 0.05;",
    to: "export const VALIDATED_MARGIN_FLOOR = 0.04;",
  },
  {
    id: "source: margin ceiling 0.25",
    file: "src/stats/compare.ts",
    from: "export const VALIDATED_MARGIN_CEILING = 0.3;",
    to: "export const VALIDATED_MARGIN_CEILING = 0.25;",
  },
  {
    id: "source: the floor-not-set reason reworded",
    file: "src/stats/compare.ts",
    from: 'export const MARGIN_FLOOR_NOT_SET = "the validated margin floor is not set yet";',
    to: 'export const MARGIN_FLOOR_NOT_SET = "the margin floor is pending";',
  },
  {
    id: "source: the trial cap checks the candidate arm only",
    file: "src/stats/compare.ts",
    from: "...(Math.max(...cells) > domain.maxTrials",
    to: "...(Math.max(...used.map((c) => c.candidate.trials)) > domain.maxTrials",
  },
  {
    id: "source: the trial cap checks the base arm only",
    file: "src/stats/compare.ts",
    from: "...(Math.max(...cells) > domain.maxTrials",
    to: "...(Math.max(...used.map((c) => c.base.trials)) > domain.maxTrials",
  },
  {
    id: "source: a margin of 0 counts as inside the range",
    file: "src/stats/compare.ts",
    from: "...(input.margin < VALIDATED_MARGIN_FLOOR",
    to: "...(input.margin > 0 && input.margin < VALIDATED_MARGIN_FLOOR",
  },
  {
    id: "source: the case minimum only for equal trial counts",
    file: "src/stats/compare.ts",
    from: "...(used.length < domain.minCases",
    to: "...(balanced && used.length < domain.minCases",
  },
  {
    id: "source: score options reach the fixed-cases interval and test",
    file: "src/stats/compare.ts",
    from: "const { interval, strata, options } = fixedCasesInterval(used, level);",
    to: 'const { strata } = fixedCasesInterval(used, level);\n    const options: ScoreOptions = { ...(input as { score?: ScoreOptions }).score, weights: "equal" };\n    const interval = { ...scoreDifferenceInterval(strata, level, "lower", options), estimand: "fixed-cases" as const };',
  },
  {
    id: "mt19937 shift",
    file: "src/stats/mt19937.ts",
    from: "const M = 397;",
    to: "const M = 396;",
  },
  {
    id: "mt19937 tempering",
    file: "src/stats/mt19937.ts",
    from: "0x9d2c5680",
    to: "0x9d2c5780",
  },
  {
    id: "mt19937 seeding multiplier",
    file: "src/stats/mt19937.ts",
    from: "1812433253",
    to: "1812433254",
  },
  {
    id: "res53 low bits",
    file: "src/stats/rng.ts",
    from: "(next() >>> 6)",
    to: "(next() >>> 5)",
  },
  {
    id: "S1 score permutation exact p without ties",
    file: "src/stats/score-permutation-core.ts",
    from: "for (let x = 0; x <= observed; x++)",
    to: "for (let x = 0; x < observed; x++)",
  },
  {
    id: "S2 score permutation weight ignores the base count",
    file: "src/stats/score-permutation-core.ts",
    from: "(c.candidate.length + c.base.length) / (c.candidate.length * c.base.length);",
    to: "1 / c.candidate.length;",
  },
  {
    id: "S3 score permutation Monte Carlo wrong tail",
    file: "src/stats/score-permutation-core.ts",
    from: "if (t <= observed + MONTE_CARLO_TOLERANCE) extreme++;",
    to: "if (t >= observed - MONTE_CARLO_TOLERANCE) extreme++;",
  },
  {
    id: "S4 score permutation Monte Carlo p without +1",
    file: "src/stats/score-permutation-core.ts",
    from: "const p = (1 + extreme) / (1 + resamples);",
    to: "const p = Math.max(extreme, 1e-300) / resamples;",
  },
  {
    id: "S5 score permutation draws with replacement",
    file: "src/stats/score-permutation-core.ts",
    from: "const pick = j + Math.floor(rng.uniform() * (pool.length - j));",
    to: "const pick = Math.floor(rng.uniform() * pool.length);",
  },
  {
    id: "S6 score permutation accepts values above 1",
    file: "src/stats/score-permutation-core.ts",
    from: "v >= 0 && v <= 1))",
    to: "v >= 0))",
  },
  {
    id: "S7 score permutation statistic over all cases",
    file: "src/stats/score-permutation-core.ts",
    from: "    used.length;\n  const plan = options.exact",
    to: "    cases.length;\n  const plan = options.exact",
  },
  {
    id: "S8 score permutation never recomputes near a level",
    file: "src/stats/score-permutation-core.ts",
    from: "Math.abs(first.p - level) <= 3 * first.monteCarloSE",
    to: "Math.abs(first.p - level) <= 0 * first.monteCarloSE",
  },
  {
    id: "S9 score permutation enumerates past the cap",
    file: "src/stats/score-permutation-core.ts",
    from: "const MAX_ASSIGNMENTS = 100_000;",
    to: "const MAX_ASSIGNMENTS = 1_000_000;",
  },
  {
    id: "S10 score permutation off-lattice values rounded onto it",
    file: "src/stats/score-permutation-core.ts",
    from: "const LATTICE_TOLERANCE = 1e-9;",
    to: "const LATTICE_TOLERANCE = 0.5;",
  },
  {
    id: "S11 score permutation lattice only up to 999",
    file: "src/stats/score-permutation-core.ts",
    from: "const MAX_DENOMINATOR = 1000;",
    to: "const MAX_DENOMINATOR = 999;",
  },
  {
    id: "S12 score permutation lattice tolerance 1e-6",
    file: "src/stats/score-permutation-core.ts",
    from: "const LATTICE_TOLERANCE = 1e-9;",
    to: "const LATTICE_TOLERANCE = 1e-6;",
  },
  {
    id: "S13 score permutation units by floor",
    file: "src/stats/score-permutation-core.ts",
    from: "const candidate = c.candidate.map((v) => Math.round(v * d));",
    to: "const candidate = c.candidate.map((v) => Math.floor(v * d));",
  },
  {
    id: "S14 score permutation labelling cap inclusive",
    file: "src/stats/score-permutation-core.ts",
    from: "labellings.some((n) => n > MAX_ASSIGNMENTS)",
    to: "labellings.some((n) => n >= MAX_ASSIGNMENTS)",
  },
  {
    id: "S15 score permutation work limit a tenth",
    file: "src/stats/score-permutation-core.ts",
    from: "plan.work <= SCORE_PERMUTATION_WORK_LIMIT",
    to: "plan.work <= SCORE_PERMUTATION_WORK_LIMIT / 10",
  },
  {
    id: "S16 score permutation no work limit",
    file: "src/stats/score-permutation-core.ts",
    from: "plan.work <= SCORE_PERMUTATION_WORK_LIMIT",
    to: "plan.work <= Infinity",
  },
  {
    id: "S17 score permutation rerun seed offset off by one",
    file: "src/stats/score-permutation-core.ts",
    from: "const NEAR_LEVEL_SEED_OFFSET = 1_000_003;",
    to: "const NEAR_LEVEL_SEED_OFFSET = 1_000_004;",
  },
  {
    id: "S18 score permutation reports the first run's p under the rerun's settings",
    file: "src/stats/score-permutation-core.ts",
    from: "  return { statistic, ...result, method:",
    to: "  return { statistic, ...result, p: first.p, method:",
  },
  {
    id: "S19 score permutation rerun seed wraps mod 2^32",
    file: "src/stats/score-permutation-core.ts",
    from: "const SEED_MODULUS = 4_294_967_295;",
    to: "const SEED_MODULUS = 4_294_967_296;",
  },
  {
    id: "estimate: weighted mean without its denominator",
    file: "src/stats/weighted-mean.ts",
    from: "  return numerator / denominator;",
    to: "  return numerator;",
  },
  {
    id: "exact test ignores the fixed strata's offset",
    file: "src/stats/exact-conditional.ts",
    from: "    const candidateTotal = t + offset;",
    to: "    const candidateTotal = t;",
  },
  {
    id: "estimate: pooled Clopper–Pearson unadjusted",
    file: "src/stats/adjusted-tail.ts",
    from: 'const tail = sided === "two" ? 1 - Math.exp(-alpha / 2) : 1 - Math.exp(-alpha);',
    to: 'const tail = sided === "two" ? alpha / 2 : alpha;',
  },
  {
    id: "estimate: pooled Clopper–Pearson two-sided at α per tail",
    file: "src/stats/adjusted-tail.ts",
    from: 'const tail = sided === "two" ? 1 - Math.exp(-alpha / 2) : 1 - Math.exp(-alpha);',
    to: 'const tail = sided === "two" ? 1 - Math.exp(-alpha) : 1 - Math.exp(-alpha);',
  },
  {
    id: "estimate: pooled Clopper–Pearson past an adjusted level of 1/4",
    file: "src/stats/adjusted-tail.ts",
    from: "const MAX_ADJUSTED_TAIL = 0.25;",
    to: "const MAX_ADJUSTED_TAIL = 0.5;",
  },
  {
    id: "sentinel: one-sided test",
    file: "src/stats/sentinel.ts",
    from: "  const p = Math.min(1, 2 * Math.min(less, greater));",
    to: "  const p = Math.min(1, Math.min(less, greater));",
  },
  {
    id: "sentinel: one-sided power",
    file: "src/stats/sentinel.ts",
    from: "rejects(Math.min(1, 2 * Math.min(below[s]!, above[s]!)), level)",
    to: "rejects(Math.min(1, Math.min(below[s]!, above[s]!)), level)",
  },
  {
    id: "sentinel: reference not at the stored rate",
    file: "src/stats/sentinel.ts",
    from: "? sentinelPowerExact(cases, trials, rate, fresh, level)",
    to: "? sentinelPowerExact(cases, trials, 0.5, fresh, level)",
  },
  {
    id: "sentinel: drift rounded down",
    file: "src/stats/sentinel.ts",
    from: "if (at >= target) return { largest, caught: true, drift: m / STEPS, power: at };",
    to: "if (at >= target) return { largest, caught: true, drift: (m - 1) / STEPS, power: at };",
  },
  {
    id: "sentinel: exact up to 10⁴ terms",
    file: "src/stats/sentinel.ts",
    from: "const EXACT_TERMS = 1e5;",
    to: "const EXACT_TERMS = 1e4;",
  },
  {
    id: "sentinel: 1,000 draws",
    file: "src/stats/sentinel.ts",
    from: "const DRAWS = 10_000;",
    to: "const DRAWS = 1_000;",
  },
  {
    id: "sentinel: new draws at each fresh rate",
    file: "src/stats/sentinel.ts",
    from: "  const rng = createRng(seed);",
    // A seed that changes with the fresh rate and stays a valid 32-bit seed, so the mutant changes
    // the draws instead of being refused by createRng.
    to: "  const rng = createRng(1 + ((seed + Math.round(fresh * 1e12)) % 4_000_000_000));",
  },
  {
    id: "sentinel: upward drift as downward",
    file: "src/stats/sentinel.ts",
    from: "    up: direction(1),",
    to: "    up: direction(-1),",
  },
  {
    id: "sentinel: Y short of the extreme",
    file: "src/stats/sentinel.ts",
    from: "const at = power(sign > 0 ? 1 : 0);",
    to: "const at = power(rate + (sign * largest) / 2);",
  },
  {
    id: "sentinel: target 3 in 4",
    file: "src/stats/sentinel.ts",
    from: "const target = input.target ?? 0.8;",
    to: "const target = input.target ?? 0.75;",
  },
];

/**
 * The mutants whose change cannot apply: the file is missing, or the anchor `from` does not occur
 * in it exactly once. Such a mutant never runs, so it would prove nothing; an anchor that occurs
 * twice may mutate the wrong place.
 */
export function anchorProblems(mutants: readonly Mutant[], root: string): string[] {
  return mutants.flatMap((m) => {
    const path = join(root, m.file);
    if (!existsSync(path)) return [`${m.id}: ${m.file} does not exist`];
    const count = readFileSync(path, "utf8").split(m.from).length - 1;
    return count === 1 ? [] : [`${m.id}: its anchor occurs ${count} times in ${m.file}, not once`];
  });
}

/**
 * Runs the selected mutants against the stats tests in `root` and returns the exit code. Every
 * anchor is checked before any source changes: one that does not apply fails the whole run.
 */
/** Runs a command in `root` and says whether it succeeded. */
function run(cmd: string, args: string[], root: string): boolean {
  try {
    execFileSync(cmd, args, { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs the selected mutants against the stats tests in `root` and returns the exit code. Every
 * anchor is checked before any source changes: one that does not apply fails the whole run. The
 * canary must survive and the control must be killed, or nothing counts (scripts/mutation.ts).
 */
export function runMutants(
  mutants: readonly Mutant[],
  root: string,
  wanted: readonly string[],
  log: (line: string) => void = console.log,
  test: (name: string) => Outcome = (name) => runTests(root, ["stats"], name),
  canary: Mutant = CANARY,
  control: Mutant = CONTROL,
): number {
  const selected = mutants.filter(
    (x) => wanted.length === 0 || wanted.some((w) => x.id.startsWith(w)),
  );
  const problems = anchorProblems([canary, control, ...selected], root);
  if (problems.length > 0) {
    for (const p of problems) log(p);
    log(`${problems.length} mutant(s) cannot apply: update them before running any`);
    return 1;
  }
  const regenerate = (): boolean =>
    run("node", ["scripts/contracts/generate-schemas.ts"], root) &&
    run("node", ["scripts/contracts/write-fixtures.ts"], root);
  const attempt = (m: Mutant): Outcome => {
    const path = join(root, m.file);
    const original = readFileSync(path, "utf8");
    writeFileSync(path, original.replace(m.from, m.to));
    try {
      if (m.regen === true && !regenerate())
        return { kind: "error", reason: "the schemas or fixtures could not be regenerated" };
      return test(m.id);
    } finally {
      writeFileSync(path, original);
      if (m.regen === true) regenerate();
    }
  };
  return runMutations({ canary, control, mutants: selected, attempt, log }).code;
}

// Importing this file runs nothing: only running it mutates the sources.
if (import.meta.main) {
  process.exitCode = runMutants(
    MUTANTS,
    join(import.meta.dirname, "..", ".."),
    process.argv.slice(2),
  );
}
