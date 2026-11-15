// The framework stays general: no application's names, paths or behaviour in framework code.
// Docs and examples may name applications; packages and repository scripts may not.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/** Terms that identify one application. The npm scope `@hephaestus-build/` is allowed. */
export const TERMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/hephaestus(?!-build\/)/i, "an application name"],
  [/\bheph\b/i, "an application name"],
  [/compositioneval|feedback-eval|gradlew/i, "an application path"],
  [/\bwithhold(ing)?\b|practice review/i, "an application concept"],
];

/** Returns one finding per line that uses an application term. */
export function findViolations(files: ReadonlyArray<{ path: string; text: string }>): string[] {
  const findings: string[] = [];
  for (const { path, text } of files) {
    text.split("\n").forEach((line, i) => {
      for (const [pattern, why] of TERMS)
        if (pattern.test(line))
          findings.push(`${path}:${i + 1}: ${why}: ${line.trim().slice(0, 100)}`);
    });
  }
  return findings;
}

if (import.meta.main) {
  const paths = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "packages", "scripts"],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(
      (f) =>
        f &&
        existsSync(f) &&
        !/scripts\/check-purity(\.test)?\.ts$/.test(f) &&
        /\.(ts|tsx|js|mjs|json|md)$/.test(f),
    );
  const findings = findViolations(
    paths.map((path) => ({ path, text: readFileSync(path, "utf8") })),
  );
  if (findings.length > 0) {
    console.error(`Framework purity check failed (${findings.length}):\n${findings.join("\n")}`);
    process.exit(1);
  }
  console.log(`purity: ${paths.length} files clean`);
}
