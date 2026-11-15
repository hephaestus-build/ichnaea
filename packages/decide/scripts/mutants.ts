// Manual mutation testing of the decision rule until StrykerJS runs at 1.0 (REQ-112). Each mutant
// is one source change that a test must detect; the list covers the 21 survivors of the review of
// cba183c and the rules added since. Run in a scratch copy, never in a working tree:
//   node scripts/mutants.ts            # every mutant
//   node scripts/mutants.ts DC-6       # selected mutants
// A mutant that survives is a test that cannot fail: kill it, or justify it as equivalent here.
// Equivalent: none claimed. Not mutated: `pa > plan.alpha` versus `>=`, because no record gives an
// adjusted p-value exactly equal to alpha.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Mutant {
  readonly id: string;
  readonly file: string;
  readonly from: string;
  readonly to: string;
}

const D = "src/decide.ts";
export const MUTANTS: readonly Mutant[] = [
  {
    id: "budget_exceeded trial ignored",
    file: D,
    from: 'input.trials.some((t) => t.outcome === "budget_exceeded")',
    to: "false",
  },
  {
    id: "monthly budget ignored",
    file: D,
    from: "plan.budget.worstCaseCalls > plan.budget.monthlyRemaining",
    to: "false",
  },
  {
    id: "verifyArms ignored",
    file: D,
    from: "for (const error of await verifyArms(plan.arms))",
    to: "for (const error of [] as Awaited<ReturnType<typeof verifyArms>>)",
  },
  {
    id: "base without values allowed",
    file: D,
    from: 'invalid.push("the base arm has no trial with a value");',
    to: "void 0;",
  },
  {
    id: "decision without arms allowed",
    file: D,
    from: 'invalid.push("a decision needs a base and a candidate arm");',
    to: "void 0;",
  },
  {
    id: "B2 decision without primary allowed",
    file: D,
    from: 'invalid.push("a decision needs a primary measure");',
    to: "void 0;",
  },
  {
    id: "B2 PASS by falling through",
    file: D,
    from: 'primaries.length > 0 && primaries.every((m) => m.verdict === "NON-INFERIOR")',
    to: "true",
  },
  {
    id: "B3 unvalidated comparison decides",
    file: D,
    from: "      if (!comparison.validated) {",
    to: "      if (false) {",
  },
  {
    id: "B3 unsupported value allowed",
    file: D,
    from: "if (decision && t.unsupported) invalid.push(t.unsupported);",
    to: "",
  },
  {
    id: "B4 second candidate allowed",
    file: D,
    from: 'if (plan.arms.filter((a) => a.role === "candidate").length > 1)',
    to: "if (false)",
  },
  {
    id: "NI at the bound",
    file: D,
    from: "const nonInferior = comparison.difference.lower > -effective;",
    to: "const nonInferior = comparison.difference.lower >= -effective;",
  },
  {
    id: "safety margin ignored",
    file: D,
    from: "const effective = p.margin - (p.safetyMargin ?? 0);",
    to: "const effective = p.margin;",
  },
  {
    id: "REGRESSION ignores non-inferiority",
    file: D,
    from: 'if (v.verdict !== "NON-INFERIOR") verdicts.set(id, { ...v, verdict: "REGRESSION" });',
    to: 'verdicts.set(id, { ...v, verdict: "REGRESSION" });',
  },
  {
    id: "Holm replaced by raw p-values",
    file: D,
    from: "const pAdjusted = holm(",
    to: "const pAdjusted = ((x: number[]) => x)(",
  },
  {
    id: "secondary measures tested",
    file: D,
    from: 'const result = tier === "primary" ? tested?.verdicts.get(id) : undefined;',
    to: "const result = tested?.verdicts.get(id) ?? tested?.verdicts.values().next().value;",
  },
  {
    id: "invalid configuration not missing",
    file: D,
    from: 'const MISSING = new Set(["infrastructure_failure", "not_run", "invalid_configuration"]);',
    to: 'const MISSING = new Set(["infrastructure_failure", "not_run"]);',
  },
  {
    id: "proportion check removed",
    file: D,
    from: "const problem = v.applicable && v.value ? proportionProblem(v.value) : undefined;",
    to: "const problem = undefined as string | undefined;",
  },
  {
    id: "not applicable counted as planned",
    file: D,
    from: "      av.notApplicable++;\n      continue;",
    to: "      av.notApplicable++;\n      av.planned++;\n      continue;",
  },
  {
    id: "DC-6 sensitivity never changes",
    file: D,
    from: "if (again.verdicts.get(id)?.verdict !== v.verdict) changed.add(id);",
    to: "",
  },
  {
    id: "DC-6 sensitivity counts nothing",
    file: D,
    from: "if (!(missingAsFailure && planned.arm === arms?.candidate)) continue;",
    to: "continue;",
  },
  {
    id: "flip threshold",
    file: D,
    from: "if (b > 0.5 && k < 0.5)",
    to: "if (b > 0.5 && k <= 0.5)",
  },
  {
    id: "power decidable forced",
    file: D,
    from: "      decidable: mde <= p.margin,",
    to: "      decidable: true,",
  },
  {
    id: "coverage over every arm",
    file: D,
    from: "    const compared = pair ? [pair.base, pair.candidate] : plan.arms.map((a) => a.name);\n    const coverage = Math.min(\n      ...compared.map((arm) => {\n        const av = t.arms.get(arm);\n        return av && av.planned > 0 ? av.available / av.planned : 0;\n      }),\n    );\n    const floor",
    to: "    const compared = plan.arms.map((a) => a.name);\n    const coverage = Math.min(\n      ...compared.map((arm) => {\n        const av = t.arms.get(arm);\n        return av && av.planned > 0 ? av.available / av.planned : 0;\n      }),\n    );\n    const floor",
  },
  {
    id: "duplicates allowed",
    file: D,
    from: "  invalid.push(...recordProblems(input));",
    to: "",
  },
  {
    id: "gate consistency ignored",
    file: D,
    from: "    if (g.passed === g.failures > 0)\n",
    to: "    if (false)\n",
  },
  {
    id: "gate without result allowed",
    file: D,
    from: "    if (!input.gates.some((g) => g.gate === id))",
    to: "    if (false)",
  },
  {
    id: "failed gate ignored",
    file: D,
    from: "  } else if (gates.some((g) => !g.passed)) {",
    to: "  } else if (false) {",
  },
  {
    id: "REQ-15 trigger check off",
    file: D,
    from: 'if (plan.trigger !== "code" && plan.trigger !== "dependency") return [];',
    to: "return [];",
  },
  {
    id: "unplanned trial allowed",
    file: D,
    from: "  if (unplannedTrial) invalid.push(",
    to: "  if (false) invalid.push(",
  },
  {
    id: "margin check off",
    file: D,
    from: "    if (!(p.margin < 1 && (p.safetyMargin ?? 0) <= p.margin))\n      invalid.push(",
    to: "    if (false)\n      invalid.push(",
  },
  {
    id: "INVALID maps to the policy",
    file: "src/plugin.ts",
    from: '  if (decision.verdict === "INVALID") return 1;',
    to: "",
  },
  {
    id: "planning floor ignored",
    file: "src/plugin.ts",
    from: "    const decidable = floor < effective;",
    to: "    const decidable = true;",
  },
];

const root = join(import.meta.dirname, "..");
const wanted = process.argv.slice(2);
const passes = (): boolean => {
  try {
    execFileSync("pnpm", ["exec", "vitest", "run", "--root", "."], { cwd: root, stdio: "ignore" });
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
    const killed = !passes();
    console.log(`${m.id}: ${killed ? "killed" : "SURVIVED"}`);
    if (!killed) survivors.push(m.id);
  } finally {
    writeFileSync(path, original);
  }
}
console.log(survivors.length === 0 ? "all mutants killed" : `survivors: ${survivors.join(", ")}`);
process.exitCode = survivors.length === 0 ? 0 : 1;
