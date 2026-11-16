// Manual mutation testing of the statistics until StrykerJS runs at 1.0 (REQ-112). Each mutant is
// one source change that a test must detect. Run in a scratch copy, never in a working tree:
//   node scripts/mutants.ts            # every mutant
//   node scripts/mutants.ts "level"     # selected mutants
// A mutant that survives is a test that cannot fail: kill it, or justify it as equivalent here.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Mutant {
  readonly id: string;
  readonly file: string;
  readonly from: string;
  readonly to: string;
  /** Regenerate schemas and fixtures first, as a schema change would. */
  readonly regen?: boolean;
}

export const MUTANTS: readonly Mutant[] = [
  {
    id: "NI null at +margin",
    file: "src/compare.ts",
    from: 'scoreDifferenceTest(strata, -input.margin, "greater", options)',
    to: 'scoreDifferenceTest(strata, input.margin, "greater", options)',
  },
  {
    id: "regression tail (fixed-cases)",
    file: "src/compare.ts",
    from: 'regressionTest = exactStratifiedTest(strata, "less");',
    to: 'regressionTest = exactStratifiedTest(strata, "greater");',
  },
  {
    id: "regression tail (Tango)",
    file: "src/compare.ts",
    from: 'const regressionTest = tangoTest(table, 0, "less", true);',
    to: 'const regressionTest = tangoTest(table, 0, "greater", true);',
  },
  {
    id: "score test tails swapped",
    file: "src/score-difference.ts",
    from: 'alternative === "greater" ? pnorm(-statistic) : pnorm(statistic)',
    to: 'alternative === "greater" ? pnorm(statistic) : pnorm(-statistic)',
  },
  {
    id: "level 1 - 2 alpha",
    file: "src/compare.ts",
    from: "const level = 1 - input.alpha;",
    to: "const level = 1 - 2 * input.alpha;",
  },
  {
    id: "MDE quantile off by one",
    file: "src/power.ts",
    from: "Math.ceil(q * sorted.length) - 1",
    to: "Math.ceil(q * sorted.length)",
  },
  {
    id: "floor default alpha 0.025",
    file: "src/power.ts",
    from: "  replicates: number,\n  alpha = 0.05,",
    to: "  replicates: number,\n  alpha = 0.025,",
  },
  {
    id: "floor default alpha 0.025 (per-case trials)",
    file: "src/power.ts",
    from: "  trials: readonly number[],\n  alpha = 0.05,",
    to: "  trials: readonly number[],\n  alpha = 0.025,",
  },
  {
    id: "res53 wrong shift",
    file: "src/rng.ts",
    from: "(next() >>> 5) * 67108864",
    to: "(next() >>> 4) * 67108864",
  },
  {
    id: "N/(N-1) default dropped",
    file: "src/score-difference.ts",
    from: "const bias = options.biasCorrection ?? true;",
    to: "const bias = options.biasCorrection ?? false;",
  },
  {
    id: "Mantel-Haenszel weights for fixed-cases",
    file: "src/compare.ts",
    from: 'weights: "equal" };',
    to: 'weights: "mantel-haenszel" };',
  },
  {
    id: "unstable skew root",
    file: "src/score-difference.ts",
    from: "return (2 * (score + c)) / (1 + Math.sqrt(discriminant));",
    to: "return (-1 + Math.sqrt(discriminant)) / (2 * c);",
  },
  {
    id: "validated everywhere",
    file: "src/compare.ts",
    from: "  validated: limitations.length === 0,",
    to: "  validated: true,",
  },
  {
    id: "exact test counts ties out",
    file: "src/exact-conditional.ts",
    from: 'alternative === "less" ? t <= observed : t >= observed',
    to: 'alternative === "less" ? t < observed : t > observed',
  },
  // Mutants that survived a review, and the missing-trial rules (decision 0009).
  {
    id: "M40 permutation wrong tail",
    file: "src/randomisation.ts",
    from: "if (statistic(x1) <= observed + tolerance) extreme++;",
    to: "if (statistic(x1) >= observed - tolerance) extreme++;",
  },
  {
    id: "M41 permutation p without +1",
    file: "src/randomisation.ts",
    from: "p: (1 + extreme) / (1 + resamples),",
    to: "p: extreme / resamples,",
  },
  {
    id: "M42 permutation with replacement",
    file: "src/randomisation.ts",
    from: "      picked++;\n      good--;\n    }\n    left--;",
    to: "      picked++;\n    }",
  },
  {
    id: "M43 permutation base rate over candidate trials",
    file: "src/randomisation.ts",
    from: "(s.candidate.successes + s.base.successes - (x1[i] as number)) / s.base.trials,",
    to: "(s.candidate.successes + s.base.successes - (x1[i] as number)) / s.candidate.trials,",
  },
  {
    id: "M44 Tango from 30 cases",
    file: "src/compare.ts",
    from: "export const SAMPLED_CASES_MIN_CASES = 300;",
    to: "export const SAMPLED_CASES_MIN_CASES = 30;",
  },
  {
    id: "M45 skew no-root returns infinity",
    file: "src/score-difference.ts",
    from: "if (discriminant < 0) return score;",
    to: "if (discriminant < 0) return score > 0 ? Infinity : -Infinity;",
  },
  {
    id: "M36 sampled-cases floor at alpha/2",
    file: "src/power.ts",
    from: '    1 - alpha,\n    "lower",\n    true,',
    to: '    1 - alpha / 2,\n    "lower",\n    true,',
  },
  {
    id: "missing trials: cases with one trial dropped",
    file: "src/compare.ts",
    from: "    .filter((c) => c.base.trials > 0 && c.candidate.trials > 0)\n    .map(",
    to: "    .filter((c) => c.base.trials > 1 && c.candidate.trials > 1)\n    .map(",
  },
  {
    id: "missing trials: gate from 3 cases",
    file: "src/compare.ts",
    from: "  minCases: 5,",
    to: "  minCases: 3,",
  },
  {
    id: "missing trials: excluded cases still validated",
    file: "src/compare.ts",
    from: "      ...(excludedCases > 0\n",
    to: "      ...(false\n",
  },
  {
    id: "missing trials: more than 3 trials validated",
    file: "src/compare.ts",
    from: "  maxTrials: 3,",
    to: "  maxTrials: 4,",
  },
  {
    id: "missing trials: sparse cells validated",
    file: "src/compare.ts",
    from: "  minShareWithTwoTrials: 0.9,",
    to: "  minShareWithTwoTrials: 0.8,",
  },
  {
    id: "missing trials: sampled-cases families ignored",
    file: "src/compare.ts",
    from: "families.size !== used.length || ",
    to: "false || ",
  },
  {
    id: "unequal counts sent to the exact test",
    file: "src/compare.ts",
    from: "const balanced = new Set(cells).size === 1;",
    to: "const balanced = true;",
  },
  {
    id: "pnorm central coefficient typo",
    file: "src/normal-coefficients.ts",
    from: "161.02823106855587",
    to: "161.02832106855587",
  },
  {
    id: "pnorm tail coefficient typo",
    file: "src/normal-coefficients.ts",
    from: "0.023073441764940174",
    to: "0.023073414764940174",
  },
  {
    id: "pnorm square not split",
    file: "src/normal.ts",
    from: "Math.trunc(x * SPLIT) / SPLIT",
    to: "x",
  },
  {
    id: "pnorm branch boundary moved",
    file: "src/normal-coefficients.ts",
    from: "central: 0.67448975",
    to: "central: 0.5",
  },
  {
    id: "pnorm branch boundary typo",
    file: "src/normal-coefficients.ts",
    from: "central: 0.67448975",
    to: "central: 0.067448975",
  },
  {
    id: "qnorm central coefficient typo",
    file: "src/normal-coefficients.ts",
    from: "13731.69376550946",
    to: "13731.69367550946",
  },
  {
    id: "qnorm far-tail coefficient typo",
    file: "src/normal-coefficients.ts",
    from: "0.014875361290850615",
    to: "0.014875316290850615",
  },
  {
    id: "qnorm central denominator typo",
    file: "src/normal-coefficients.ts",
    from: "5226.495278852854",
    to: "5226.495278852546",
  },
  {
    id: "pnorm tail bound of R 4.4",
    file: "src/normal-coefficients.ts",
    from: "lowerTail: -38.4674",
    to: "lowerTail: -37.5193",
  },
  {
    id: "qnorm subnormal p on the far rational",
    file: "src/normal-coefficients.ts",
    from: "far: 27",
    to: "far: 30",
  },
  // Not a mutant: changing the fifth-order term of qnorm's asymptotic expansion, (5 - 9 / (8 + x2))
  // to (5 - 9 / (6 + x2)), moves the result by at most 0.84 ε·|v|, on 1 % of 2,000,000 subnormal p.
  // That is below rounding, so no reference value can detect it.
  {
    id: "pnorm small-x cutoff",
    file: "src/normal.ts",
    from: "const HALF_EPSILON = Number.EPSILON / 2;",
    to: "const HALF_EPSILON = 1e-3;",
  },
  {
    id: "pnorm tail cutoff too early",
    file: "src/normal-coefficients.ts",
    from: "lowerTail: -38.4674",
    to: "lowerTail: -38.2",
  },
  {
    id: "pnorm second boundary lower",
    file: "src/normal.ts",
    from: "const SQRT_32 = 5.656854249492381;",
    to: "const SQRT_32 = 5.5;",
  },
  {
    id: "pnorm second boundary higher",
    file: "src/normal.ts",
    from: "const SQRT_32 = 5.656854249492381;",
    to: "const SQRT_32 = 6;",
  },
  {
    id: "pnorm first boundary higher",
    file: "src/normal-coefficients.ts",
    from: "central: 0.67448975",
    to: "central: 0.8",
  },
  {
    id: "pnorm square split coarser",
    file: "src/normal-coefficients.ts",
    from: "splitExponent: 4",
    to: "splitExponent: 3",
  },
  {
    id: "qnorm central boundary lower",
    file: "src/normal-coefficients.ts",
    from: "central: 0.425",
    to: "central: 0.42",
  },
  {
    id: "rule: confirmed coverage threshold 0.93",
    file: "test/support/simulate.ts",
    from: "c + 3 * s < 0.94",
    to: "c + 3 * s < 0.93",
  },
  {
    id: "rule: confirmed coverage allowance 10\u00b7SE",
    file: "test/support/simulate.ts",
    from: "c + 3 * s < 0.94",
    to: "c + 10 * s < 0.94",
  },
  {
    id: "rule: coverage screen at 0.94 \u2212 2\u00b7SE",
    file: "test/support/simulate.ts",
    from: "clears: (c, s) => c >= 0.94 + 2 * s",
    to: "clears: (c, s) => c >= 0.94 - 2 * s",
  },
  {
    id: "rule: exact coverage threshold 0.93",
    file: "test/support/simulate.ts",
    from: "e.value < 0.94 : e.value > 0.05",
    to: "e.value < 0.93 : e.value > 0.05",
  },
  {
    id: "rule: exact type-I threshold 0.06",
    file: "test/support/simulate.ts",
    from: "e.value < 0.94 : e.value > 0.05",
    to: "e.value < 0.94 : e.value > 0.06",
  },
  {
    id: "rule: no grid-mean rule",
    file: "test/support/simulate.ts",
    from: "if (mean + 3 * meanSe < rule.nominal)",
    to: "if (mean + 3 * meanSe < 0)",
  },
  {
    id: "rule: grid-mean allowance 6\u00b7SE",
    file: "test/support/simulate.ts",
    from: "if (mean + 3 * meanSe < rule.nominal)",
    to: "if (mean + 6 * meanSe < rule.nominal)",
  },
  {
    id: "rule: grid-mean SEs added linearly",
    file: "test/support/simulate.ts",
    from: "Math.sqrt(estimates.reduce((a, e) => a + e.se ** 2, 0)) / estimates.length",
    to: "estimates.reduce((a, e) => a + e.se, 0) / estimates.length",
  },
  {
    id: "rule: exact coverage cut at 0.9399 or less",
    file: "test/support/simulate.ts",
    from: "e.value < 0.94 : e.value > 0.05",
    to: "e.value <= 0.9399 : e.value > 0.05",
  },
  {
    id: "rule: confirmed type-I threshold 0.07",
    file: "test/support/simulate.ts",
    from: "fails: (p, s) => p - 3 * s > 0.05",
    to: "fails: (p, s) => p - 3 * s > 0.07",
  },
  {
    id: "rule: type-I screen at 0.05 + 2\u00b7SE",
    file: "test/support/simulate.ts",
    from: "clears: (p, s) => p <= 0.05 - 2 * s",
    to: "clears: (p, s) => p <= 0.05 + 2 * s",
  },
  {
    id: "rule: confirmation to SE 0.003",
    file: "test/support/simulate.ts",
    from: "export const CONFIRM_SE = 0.0005;",
    to: "export const CONFIRM_SE = 0.003;",
  },
  {
    id: "rule: one confirmation batch",
    file: "test/support/simulate.ts",
    from: "} while (se(hits / reps, reps) > CONFIRM_SE);",
    to: "} while (false);",
  },
  {
    id: "rule: confirmation reuses the screening seed",
    file: "test/support/simulate.ts",
    from: "createRng(point.seed + CONFIRM_SEED_OFFSET)",
    to: "createRng(point.seed)",
  },
  {
    id: "rule: candidate cap on type-I grids",
    file: "test/support/simulate.ts",
    from: 'rule.kind === "coverage" && candidates.length > MAX_CANDIDATES',
    to: "candidates.length > MAX_CANDIDATES",
  },
  {
    id: "rule: no candidate cap on coverage grids",
    file: "test/support/simulate.ts",
    from: 'rule.kind === "coverage" && candidates.length > MAX_CANDIDATES',
    to: "false && candidates.length > MAX_CANDIDATES",
  },
  {
    id: "source: edge clamp 1e-3",
    file: "src/score-difference.ts",
    from: "const EDGE = 1e-12;",
    to: "const EDGE = 1e-3;",
  },
  {
    id: "source: exact test lower support with unequal arms",
    file: "src/exact-conditional.ts",
    from: "const lo = Math.max(0, total - n2);",
    to: "const lo = Math.max(0, total - n1);",
  },
  {
    id: "source: exact test upper support with unequal arms",
    file: "src/exact-conditional.ts",
    from: "const hi = Math.min(n1, total);",
    to: "const hi = Math.min(n2, total);",
  },
  {
    id: "source: input order decides",
    file: "src/compare.ts",
    from: "const ordered = input.cases.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));",
    to: "const ordered = [...input.cases];",
  },
  {
    id: "source: floor weights by Mantel\u2013Haenszel",
    file: "src/power.ts",
    from: '{ weights: "equal", ...options }',
    to: '{ weights: "mantel-haenszel", ...options }',
  },
  {
    id: "source: margin 1 accepted",
    file: "src/compare.ts",
    from: "input.margin >= 0 && input.margin < 1",
    to: "input.margin >= 0 && input.margin <= 1",
  },
  {
    id: "source: negative margin accepted",
    file: "src/compare.ts",
    from: "input.margin >= 0 && input.margin < 1",
    to: "input.margin >= -1 && input.margin < 1",
  },
  {
    id: "source: missing generator falls back to the exact test",
    file: "src/compare.ts",
    from: "      if (!input.rng)\n        throw new EstimandError(",
    to: "      if (!input.rng) return compareCounts({ ...input, cases: input.cases.map((c) => ({ ...c, base: { ...c.base, trials: c.candidate.trials, successes: Math.min(c.base.successes, c.candidate.trials) } })) });\n      if (!input.rng)\n        throw new EstimandError(",
  },
  {
    id: "source: a proportion passes as counts",
    file: "src/compare.ts",
    from: 'if (input.valueType !== "binary")',
    to: 'if (input.valueType === "score")',
  },
  {
    id: "source: margin ceiling 1",
    file: "src/compare.ts",
    from: "export const VALIDATED_MARGIN_CEILING = 0.3;",
    to: "export const VALIDATED_MARGIN_CEILING = 1;",
  },
  {
    id: "source: the margin floor counts as set",
    file: "src/compare.ts",
    from: "export const VALIDATED_MARGIN_FLOOR_SET = false;",
    to: "export const VALIDATED_MARGIN_FLOOR_SET = true;",
  },
  {
    id: "source: the floor-not-set reason dropped",
    file: "src/compare.ts",
    from: "...(VALIDATED_MARGIN_FLOOR_SET ? [] : [MARGIN_FLOOR_NOT_SET]),",
    to: "...([] as string[]),",
  },
  {
    id: "source: regression depends on the margin",
    file: "src/compare.ts",
    from: "regression: validity(domainLimitations),",
    to: "regression: validity([...domainLimitations, ...marginLimitations]),",
  },
  {
    id: "source: non-inferiority ignores the domain",
    file: "src/compare.ts",
    from: "nonInferiority: validity([...domainLimitations, ...marginLimitations]),",
    to: "nonInferiority: validity(marginLimitations),",
  },
  {
    id: "source: sampled-cases regression validated",
    file: "src/compare.ts",
    from: "    regression: validity(experimental),",
    to: "    regression: validity([]),",
  },
  {
    id: "source: margin floor 0",
    file: "src/compare.ts",
    from: "export const VALIDATED_MARGIN_FLOOR = 0.05;",
    to: "export const VALIDATED_MARGIN_FLOOR = 0;",
  },
  {
    id: "source: margin floor 0.06",
    file: "src/compare.ts",
    from: "export const VALIDATED_MARGIN_FLOOR = 0.05;",
    to: "export const VALIDATED_MARGIN_FLOOR = 0.06;",
  },
  {
    id: "source: margin floor 0.04",
    file: "src/compare.ts",
    from: "export const VALIDATED_MARGIN_FLOOR = 0.05;",
    to: "export const VALIDATED_MARGIN_FLOOR = 0.04;",
  },
  {
    id: "source: margin ceiling 0.25",
    file: "src/compare.ts",
    from: "export const VALIDATED_MARGIN_CEILING = 0.3;",
    to: "export const VALIDATED_MARGIN_CEILING = 0.25;",
  },
  {
    id: "source: the floor-not-set reason reworded",
    file: "src/compare.ts",
    from: 'export const MARGIN_FLOOR_NOT_SET = "the validated margin floor is not set yet";',
    to: 'export const MARGIN_FLOOR_NOT_SET = "the margin floor is pending";',
  },
  {
    id: "source: the trial cap checks the candidate arm only",
    file: "src/compare.ts",
    from: "...(Math.max(...cells) > domain.maxTrials",
    to: "...(Math.max(...used.map((c) => c.candidate.trials)) > domain.maxTrials",
  },
  {
    id: "source: the trial cap checks the base arm only",
    file: "src/compare.ts",
    from: "...(Math.max(...cells) > domain.maxTrials",
    to: "...(Math.max(...used.map((c) => c.base.trials)) > domain.maxTrials",
  },
  {
    id: "source: a margin of 0 counts as inside the range",
    file: "src/compare.ts",
    from: "...(input.margin < VALIDATED_MARGIN_FLOOR",
    to: "...(input.margin > 0 && input.margin < VALIDATED_MARGIN_FLOOR",
  },
  {
    id: "source: the case minimum only for equal trial counts",
    file: "src/compare.ts",
    from: "...(used.length < domain.minCases",
    to: "...(balanced && used.length < domain.minCases",
  },
  {
    id: "source: score options reach the fixed-cases interval and test",
    file: "src/compare.ts",
    from: "const { interval, strata, options } = fixedCasesInterval(used, level);",
    to: 'const { strata } = fixedCasesInterval(used, level);\n    const options: ScoreOptions = { ...(input as { score?: ScoreOptions }).score, weights: "equal" };\n    const interval = { ...scoreDifferenceInterval(strata, level, "lower", options), estimand: "fixed-cases" as const };',
  },
  {
    id: "mt19937 shift",
    file: "src/mt19937.ts",
    from: "const M = 397;",
    to: "const M = 396;",
  },
  {
    id: "mt19937 tempering",
    file: "src/mt19937.ts",
    from: "0x9d2c5680",
    to: "0x9d2c5780",
  },
  {
    id: "mt19937 seeding multiplier",
    file: "src/mt19937.ts",
    from: "1812433253",
    to: "1812433254",
  },
  {
    id: "res53 low bits",
    file: "src/rng.ts",
    from: "(next() >>> 6)",
    to: "(next() >>> 5)",
  },
  {
    id: "S1 score permutation exact p without ties",
    file: "src/score-permutation-core.ts",
    from: "for (let x = 0; x <= observed; x++)",
    to: "for (let x = 0; x < observed; x++)",
  },
  {
    id: "S2 score permutation weight ignores the base count",
    file: "src/score-permutation-core.ts",
    from: "(c.candidate.length + c.base.length) / (c.candidate.length * c.base.length);",
    to: "1 / c.candidate.length;",
  },
  {
    id: "S3 score permutation Monte Carlo wrong tail",
    file: "src/score-permutation-core.ts",
    from: "if (t <= observed + MONTE_CARLO_TOLERANCE) extreme++;",
    to: "if (t >= observed - MONTE_CARLO_TOLERANCE) extreme++;",
  },
  {
    id: "S4 score permutation Monte Carlo p without +1",
    file: "src/score-permutation-core.ts",
    from: "const p = (1 + extreme) / (1 + resamples);",
    to: "const p = Math.max(extreme, 1e-300) / resamples;",
  },
  {
    id: "S5 score permutation draws with replacement",
    file: "src/score-permutation-core.ts",
    from: "const pick = j + Math.floor(rng.uniform() * (pool.length - j));",
    to: "const pick = Math.floor(rng.uniform() * pool.length);",
  },
  {
    id: "S6 score permutation accepts values above 1",
    file: "src/score-permutation-core.ts",
    from: "v >= 0 && v <= 1))",
    to: "v >= 0))",
  },
  {
    id: "S7 score permutation statistic over all cases",
    file: "src/score-permutation-core.ts",
    from: "    used.length;\n  const plan = options.exact",
    to: "    cases.length;\n  const plan = options.exact",
  },
  {
    id: "S8 score permutation never recomputes near a level",
    file: "src/score-permutation-core.ts",
    from: "Math.abs(first.p - level) <= 3 * first.monteCarloSE",
    to: "Math.abs(first.p - level) <= 0 * first.monteCarloSE",
  },
  {
    id: "S9 score permutation enumerates past the cap",
    file: "src/score-permutation-core.ts",
    from: "const MAX_ASSIGNMENTS = 100_000;",
    to: "const MAX_ASSIGNMENTS = 1_000_000;",
  },
  {
    id: "S10 score permutation off-lattice values rounded onto it",
    file: "src/score-permutation-core.ts",
    from: "const LATTICE_TOLERANCE = 1e-9;",
    to: "const LATTICE_TOLERANCE = 0.5;",
  },
  {
    id: "S11 score permutation lattice only up to 999",
    file: "src/score-permutation-core.ts",
    from: "const MAX_DENOMINATOR = 1000;",
    to: "const MAX_DENOMINATOR = 999;",
  },
  {
    id: "S12 score permutation lattice tolerance 1e-6",
    file: "src/score-permutation-core.ts",
    from: "const LATTICE_TOLERANCE = 1e-9;",
    to: "const LATTICE_TOLERANCE = 1e-6;",
  },
  {
    id: "S13 score permutation units by floor",
    file: "src/score-permutation-core.ts",
    from: "const candidate = c.candidate.map((v) => Math.round(v * d));",
    to: "const candidate = c.candidate.map((v) => Math.floor(v * d));",
  },
  {
    id: "S14 score permutation labelling cap inclusive",
    file: "src/score-permutation-core.ts",
    from: "labellings.some((n) => n > MAX_ASSIGNMENTS)",
    to: "labellings.some((n) => n >= MAX_ASSIGNMENTS)",
  },
  {
    id: "S15 score permutation work limit a tenth",
    file: "src/score-permutation-core.ts",
    from: "plan.work <= SCORE_PERMUTATION_WORK_LIMIT",
    to: "plan.work <= SCORE_PERMUTATION_WORK_LIMIT / 10",
  },
  {
    id: "S16 score permutation no work limit",
    file: "src/score-permutation-core.ts",
    from: "plan.work <= SCORE_PERMUTATION_WORK_LIMIT",
    to: "plan.work <= Infinity",
  },
  {
    id: "S17 score permutation rerun seed offset off by one",
    file: "src/score-permutation-core.ts",
    from: "const NEAR_LEVEL_SEED_OFFSET = 1_000_003;",
    to: "const NEAR_LEVEL_SEED_OFFSET = 1_000_004;",
  },
  {
    id: "S18 score permutation reports the first run's p under the rerun's settings",
    file: "src/score-permutation-core.ts",
    from: "  return { statistic, ...result, method:",
    to: "  return { statistic, ...result, p: first.p, method:",
  },
  {
    id: "S19 score permutation rerun seed wraps mod 2^32",
    file: "src/score-permutation-core.ts",
    from: "const SEED_MODULUS = 4_294_967_295;",
    to: "const SEED_MODULUS = 4_294_967_296;",
  },
];

const root = join(import.meta.dirname, "..");
const wanted = process.argv.slice(2);
const run = (cmd: string, args: string[]): boolean => {
  try {
    execFileSync(cmd, args, { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const survivors: string[] = [];
for (const m of MUTANTS.filter(
  (x) => wanted.length === 0 || wanted.some((w) => x.id.startsWith(w)),
)) {
  const path = join(root, m.file);
  const original = readFileSync(path, "utf8");
  if (!original.includes(m.from)) {
    console.log(`${m.id}: anchor not found (update the mutant)`);
    survivors.push(m.id);
    continue;
  }
  writeFileSync(path, original.replace(m.from, m.to));
  try {
    if (m.regen) {
      run("node", ["scripts/generate-schemas.ts"]);
      run("node", ["scripts/write-fixtures.ts"]);
    }
    const killed = !run("pnpm", ["exec", "vitest", "run", "--root", "."]);
    console.log(`${m.id}: ${killed ? "killed" : "SURVIVED"}`);
    if (!killed) survivors.push(m.id);
  } finally {
    writeFileSync(path, original);
    if (m.regen) {
      run("node", ["scripts/generate-schemas.ts"]);
      run("node", ["scripts/write-fixtures.ts"]);
    }
  }
}
console.log(survivors.length === 0 ? "all mutants killed" : `survivors: ${survivors.join(", ")}`);
process.exitCode = survivors.length === 0 ? 0 : 1;
