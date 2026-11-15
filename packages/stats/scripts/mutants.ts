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
    from: 'regressionP = exactStratifiedTest(strata, "less").p;',
    to: 'regressionP = exactStratifiedTest(strata, "greater").p;',
  },
  {
    id: "regression tail (Tango)",
    file: "src/compare.ts",
    from: 'regressionP: tangoTest(table, 0, "less", true).p,',
    to: 'regressionP: tangoTest(table, 0, "greater", true).p,',
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
    from: "  replicates: number,\n  alpha = 0.05,\n  options: ScoreOptions = {},\n): number {\n  const strata",
    to: "  replicates: number,\n  alpha = 0.025,\n  options: ScoreOptions = {},\n): number {\n  const strata",
  },
  {
    id: "res53 wrong shift",
    file: "src/rng.ts",
    from: "(generator() >>> 5) * 67108864",
    to: "(generator() >>> 4) * 67108864",
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
    from: "validated: balanced && used.length >= 3,",
    to: "validated: true,",
  },
  {
    id: "exact test counts ties out",
    file: "src/exact-conditional.ts",
    from: 'alternative === "less" ? t <= observed : t >= observed',
    to: 'alternative === "less" ? t < observed : t > observed',
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
