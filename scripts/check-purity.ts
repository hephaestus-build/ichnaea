// The framework stays general: no application's names, paths or behaviour in framework code.
// Docs and examples may name applications; packages and repository scripts may not.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TERMS: ReadonlyArray<[RegExp, string]> = [
  [/hephaestus(?!-build\/)/i, "an application name (the npm scope @hephaestus-build/ is allowed)"],
  [/\bheph\b/i, "an application name"],
  [/compositioneval|feedback-eval|gradlew/i, "an application path"],
  [/\bwithhold(ing)?\b|practice review/i, "an application concept"],
];

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "packages", "scripts"],
  { encoding: "utf8" },
)
  .split("\n")
  .filter(
    (f) => f && !f.endsWith("scripts/check-purity.ts") && /\.(ts|tsx|js|mjs|json|md)$/.test(f),
  );

const findings: string[] = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const [pattern, why] of TERMS)
      if (pattern.test(line))
        findings.push(`${file}:${i + 1}: ${why}: ${line.trim().slice(0, 100)}`);
  });
}
if (findings.length > 0) {
  console.error(`Framework purity check failed (${findings.length}):\n${findings.join("\n")}`);
  process.exit(1);
}
console.log(`purity: ${files.length} files clean`);
