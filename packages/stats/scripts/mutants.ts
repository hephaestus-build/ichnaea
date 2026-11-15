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
    from: 'regression = exactStratifiedTest(strata, "less");',
    to: 'regression = exactStratifiedTest(strata, "greater");',
  },
  {
    id: "regression tail (Tango)",
    file: "src/compare.ts",
    from: 'const regression = tangoTest(table, 0, "less", true);',
    to: 'const regression = tangoTest(table, 0, "greater", true);',
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
    from: "      validated: limitations.length === 0,",
    to: "      validated: true,",
  },
  {
    id: "exact test counts ties out",
    file: "src/exact-conditional.ts",
    from: 'alternative === "less" ? t <= observed : t >= observed',
    to: 'alternative === "less" ? t < observed : t > observed',
  },
  // Re-review of 23ac6ca: the surviving mutants and the DC-6 rules.
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
    id: "DC-6 cases with one trial dropped",
    file: "src/compare.ts",
    from: "    .filter((c) => c.base.trials > 0 && c.candidate.trials > 0)\n    .map(",
    to: "    .filter((c) => c.base.trials > 1 && c.candidate.trials > 1)\n    .map(",
  },
  {
    id: "DC-6 gate from 3 cases",
    file: "src/compare.ts",
    from: "  minCases: 5,",
    to: "  minCases: 3,",
  },
  {
    id: "DC-6 excluded cases still validated",
    file: "src/compare.ts",
    from: "      ...(excludedCases > 0\n",
    to: "      ...(false\n",
  },
  {
    id: "DC-6 more than 5 trials validated",
    file: "src/compare.ts",
    from: "  maxTrials: 5,",
    to: "  maxTrials: 6,",
  },
  {
    id: "DC-6 sparse cells validated",
    file: "src/compare.ts",
    from: "  minShareWithTwoTrials: 0.9,",
    to: "  minShareWithTwoTrials: 0.8,",
  },
  {
    id: "DC-6 sampled-cases families ignored",
    file: "src/compare.ts",
    from: "    families.size !== used.length ||",
    to: "    false ||",
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
    from: "Math.trunc(x * 16) / 16",
    to: "x",
  },
  {
    id: "pnorm branch boundary moved",
    file: "src/normal.ts",
    from: "y <= 0.67448975",
    to: "y <= 0.5",
  },
  {
    id: "pnorm branch boundary typo",
    file: "src/normal.ts",
    from: "y <= 0.67448975",
    to: "y <= 0.067448975",
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
    file: "src/normal.ts",
    from: "x > -38.4674",
    to: "x > -37.5193",
  },
  {
    id: "qnorm subnormal p on the far rational",
    file: "src/normal.ts",
    from: "} else if (r <= 27) {",
    to: "} else if (r <= 30) {",
  },
  // Not a mutant: changing the fifth-order term of qnorm's asymptotic expansion, (5 - 9 / (8 + x2))
  // to (5 - 9 / (6 + x2)), moves the result by at most 0.84 ulps, on 1 % of 2,000,000 subnormal p.
  // That is below rounding, so no reference value can detect it.
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
