// The framework stays general: no application's names, paths or behaviour in framework code.
// Docs and examples may name applications; packages and repository scripts may not.
// No tracked file cites a private design record: state the rule in place, or cite a decision record
// in docs/decisions by number.
//
// No tracked file is a changeset: the titles on main are the change log (decision 0019).
//
// `node scripts/check-purity.ts` checks the repository. `--stdin` and `--env NAME` check text for
// private records only, such as a pull request title and body that CI passes in environment
// variables.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { trackedFiles } from "./tracked-files.ts";

/**
 * Terms that identify one application. Only the whole word `hephaestus-build`, the organisation and
 * npm scope, is allowed: it also appears in tarball names such as `hephaestus-build-ichnaea-core`.
 */
export const TERMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/hephaestus(?!-build\b)/i, "an application name"],
  [/\bheph\b/i, "an application name"],
  [/compositioneval|feedback-eval|gradlew/i, "an application path"],
  [/\bwithhold(ing)?\b|practice review/i, "an application concept"],
];

/**
 * What a private design record looks like in text: a decision, quality-gate or finding number, a
 * review file name or label, the name of the workstream, and a path on a maintainer's machine.
 * The lowercase, spaced and Unicode forms count too: a dash is any dash, a digit is any digit.
 * Each pattern is written so that its own source does not match it (a bracket or an escape sits
 * inside each literal), so the check scans its own file. A pattern may span a line break and the
 * comment marker that starts the next line.
 */
export const PRIVATE_RECORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bD[NC][\p{Zs}\t\p{Pd}\u2212]\p{Nd}/iu, "a private decision number"],
  // Without a separator the match is upper case and not inside base64 text, as in a lockfile hash.
  [/(?<![+/=])\bD[NC]\p{Nd}/u, "a private decision number"],
  [/\b(?:Q[G]|L[R]|S[N])[\p{Pd}\u2212]\p{Nd}/iu, "a private gate or finding number"],
  [/\b[BMN]-R\p{Nd}+-\p{Nd}+/iu, "a private finding number"],
  [/\bR-M\p{Nd}+/iu, "a private finding number"],
  [/-review\.md\b/i, "a private review file"],
  [/\b\w*\p{Nd}\w*(?:-\w+)*-review\b/iu, "a private review file"],
  [/\bDESIGN-LO[G]\.md\b/i, "a private design log"],
  [/\bindependent[\s/*#>]+review\b/i, "a private review label"],
  [/\bTHEM[I]S\b/i, "a private workstream name"],
  [/\bthe\s+coordinator\b/i, "a private role name"],
  [/\/U[s]ers\/[^\s/]/, "a local path"],
  [/(?<![\w.])\.conte[x]t\//, "a local workspace path"],
];

/** Returns one finding per private record, and line, in the given files. */
export function findPrivateReferences(
  files: ReadonlyArray<{ path: string; text: string }>,
): string[] {
  const findings = new Set<string>();
  for (const { path, text } of files) {
    const lines = text.split("\n");
    for (const [pattern, why] of PRIVATE_RECORDS)
      for (const { index } of text.matchAll(new RegExp(pattern, `${pattern.flags}g`))) {
        const line = text.slice(0, index).split("\n").length;
        findings.add(`${path}:${line}: ${why}: ${lines[line - 1]?.trim().slice(0, 100)}`);
      }
  }
  return [...findings];
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

/**
 * Returns one finding per tracked file under `.changeset/`. Ichnaea keeps no Changesets: the
 * conventional commit titles on signed `main` are the change log (decision 0019, point 9).
 */
export function findChangesets(paths: readonly string[]): string[] {
  return paths
    .filter((path) => path.startsWith(".changeset/"))
    .map(
      (path) => `${path}: a changeset, but the titles on main are the change log (decision 0019)`,
    );
}

/** Reads the texts that `--stdin` and `--env` name. An unset variable is an error, not empty text. */
function readTextInputs(args: {
  stdin?: boolean;
  env?: string[];
}): Array<{ path: string; text: string }> {
  const inputs = (args.env ?? []).map((name) => {
    const text = process.env[name];
    if (text === undefined) throw new Error(`the environment variable ${name} is not set`);
    return { path: `$${name}`, text };
  });
  if (args.stdin) inputs.push({ path: "stdin", text: readFileSync(0, "utf8") });
  return inputs;
}

function checkRepository(): void {
  const tracked = trackedFiles();
  const texts = tracked
    .map((path) => ({ path, text: readFileSync(path, "utf8") }))
    .filter(({ text }) => !text.includes("\0"));
  const sources = texts.filter(
    ({ path }) =>
      /^(packages|scripts)\//.test(path) &&
      !/scripts\/check-purity(\.test)?\.ts$/.test(path) &&
      /\.(ts|tsx|js|mjs|json|md)$/.test(path),
  );
  const findings = [
    ...findViolations(sources),
    ...findPrivateReferences(texts),
    ...findChangesets(tracked),
  ];
  if (findings.length > 0) {
    console.error(`Framework purity check failed (${findings.length}):\n${findings.join("\n")}`);
    process.exit(1);
  }
  console.log(`purity: ${sources.length} source files and ${texts.length} tracked files clean`);
}

function checkTexts(inputs: Array<{ path: string; text: string }>): void {
  const findings = findPrivateReferences(inputs);
  if (findings.length > 0) {
    console.error(`Private record check failed (${findings.length}):\n${findings.join("\n")}`);
    process.exit(1);
  }
  console.log(`purity: ${inputs.length} texts clean`);
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: { stdin: { type: "boolean" }, env: { type: "string", multiple: true } },
    });
    if (values.stdin || values.env) checkTexts(readTextInputs(values));
    else checkRepository();
  } catch (error) {
    console.error(`purity: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}
