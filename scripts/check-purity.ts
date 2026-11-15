// The framework stays general: no application's names, paths or behaviour in framework code.
// Docs and examples may name applications; packages and repository scripts may not.
// No tracked file cites a private design record: state the rule in place, or cite a decision record
// in docs/decisions by number.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/** Terms that identify one application. The npm scope `@hephaestus-build/` is allowed. */
export const TERMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/hephaestus(?!-build\/)/i, "an application name"],
  [/\bheph\b/i, "an application name"],
  [/compositioneval|feedback-eval|gradlew/i, "an application path"],
  [/\bwithhold(ing)?\b|practice review/i, "an application concept"],
];

/**
 * What a private design record looks like in text: a decision or design-change number, a review
 * file name, and the label of a review round. Each pattern is written so that its own source does
 * not match it (an escape sits inside each literal), so the check scans its own file.
 */
export const PRIVATE_RECORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:D[NC])-[0-9]/, "a private decision number"],
  [/-review\.md\b/i, "a private review file"],
  [/\(independent\sreview\)/i, "a private review label"],
];

/** Returns one finding per line that cites a private design record. */
export function findPrivateReferences(
  files: ReadonlyArray<{ path: string; text: string }>,
): string[] {
  const findings: string[] = [];
  for (const { path, text } of files) {
    text.split("\n").forEach((line, i) => {
      for (const [pattern, why] of PRIVATE_RECORDS)
        if (pattern.test(line))
          findings.push(`${path}:${i + 1}: ${why}: ${line.trim().slice(0, 100)}`);
    });
  }
  return findings;
}

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
  const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => f && existsSync(f));
  const texts = tracked
    .map((path) => ({ path, text: readFileSync(path, "utf8") }))
    .filter(({ text }) => !text.includes("\0"));
  const sources = texts.filter(
    ({ path }) =>
      /^(packages|scripts)\//.test(path) &&
      !/scripts\/check-purity(\.test)?\.ts$/.test(path) &&
      /\.(ts|tsx|js|mjs|json|md)$/.test(path),
  );
  const findings = [...findViolations(sources), ...findPrivateReferences(texts)];
  if (findings.length > 0) {
    console.error(`Framework purity check failed (${findings.length}):\n${findings.join("\n")}`);
    process.exit(1);
  }
  console.log(`purity: ${sources.length} source files and ${texts.length} tracked files clean`);
}
