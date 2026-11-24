// The framework stays general: no application's names, paths or behaviour in framework code.
// Docs and examples may name applications; packages and repository scripts may not.
// No tracked file cites a private design record: state the rule in place, or cite a decision record
// in docs/decisions by number.
//
// No tracked file is a changeset: the titles on main are the change log (decision 0021).
//
// `node scripts/check-purity.ts` checks the repository. `--stdin` and `--env NAME` check text for
// private records only, such as a pull request title and body that CI passes in environment
// variables.
import { readFileSync } from "node:fs";
import { extname, relative, sep } from "node:path";
import { parseArgs } from "node:util";

import ts from "typescript-compiler";

import {
  inspectSource,
  inspectTree,
  lineOf,
  moduleReference,
  moduleResolver,
  projectSources,
  typescriptFile,
} from "./lint-typescript.ts";
import { trackedFiles } from "./tracked-files.ts";

/**
 * Terms that identify one application. Only the whole word `hephaestus-build`, the GitHub
 * organisation, is allowed because it appears in the repository URL.
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

const eventAction = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const equality = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

function comparison(node: ts.Node) {
  if (!ts.isBinaryExpression(node) || !equality.has(node.operatorToken.kind)) return undefined;
  const { left, right } = node;
  if (ts.isStringLiteralLike(right)) return { input: left, literal: right };
  if (ts.isStringLiteralLike(left)) return { input: right, literal: left };
  return undefined;
}

/** The literal entries of an array or Set at a membership check. */
function members(expression: ts.Expression, checker: ts.TypeChecker): readonly ts.Expression[] {
  let value = expression;
  if (ts.isIdentifier(value)) {
    const declaration = checker.getSymbolAtLocation(value)?.valueDeclaration;
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer)
      value = declaration.initializer;
  }
  if (
    ts.isNewExpression(value) &&
    ts.isIdentifier(value.expression) &&
    value.expression.text === "Set"
  )
    value = value.arguments?.[0] ?? value;
  if (ts.isAsExpression(value) || ts.isSatisfiesExpression(value)) value = value.expression;
  return ts.isArrayLiteralExpression(value) ? value.elements : [];
}

function isOpen(type: ts.Type): boolean {
  const open = ts.TypeFlags.String | ts.TypeFlags.Any | ts.TypeFlags.Unknown;
  return (type.flags & open) !== 0 || (type.isUnion() && type.types.some(isOpen));
}

/** Flags literal event selectors applied to an open string, before a plugin normalizes it. */
function rawEventFilter(
  node: ts.Node,
  checker: ts.TypeChecker,
  extensions: ReadonlySet<string>,
): boolean {
  const openString = (input: ts.Expression): boolean => isOpen(checker.getTypeAtLocation(input));
  const wire = (literal: ts.Expression): boolean =>
    ts.isStringLiteralLike(literal) &&
    eventAction.test(literal.text) &&
    !extensions.has(extname(literal.text));
  const direct = comparison(node);
  if (direct && wire(direct.literal) && openString(direct.input)) return true;
  if (ts.isCaseClause(node) && wire(node.expression) && ts.isSwitchStatement(node.parent.parent))
    return openString(node.parent.parent.expression);
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const { name, expression } = node.expression;
    const [input] = node.arguments;
    if (input && (name.text === "includes" || name.text === "has"))
      return members(expression, checker).some(wire) && openString(input);
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    const first = comparison(node.left)?.input;
    const second = comparison(node.right)?.input;
    if (
      !first ||
      !second ||
      !ts.isPropertyAccessExpression(first) ||
      !ts.isPropertyAccessExpression(second)
    )
      return false;
    const fields = new Set([first.name.text, second.name.text]);
    return (
      fields.has("name") &&
      fields.has("action") &&
      first.expression.getText() === second.expression.getText() &&
      openString(first) &&
      openString(second)
    );
  }
  return false;
}

const frameworkCode = (path: string): boolean =>
  path.startsWith("packages/") && !path.includes("/test/");

function behaviorProblems(
  files: ReadonlyArray<{ path: string; text: string }>,
  extensions: ReadonlySet<string>,
): string[] {
  const resolve = moduleResolver();
  const project = projectSources(
    files
      .map(({ path }) => path)
      .filter((path) => frameworkCode(path) && typescriptFile.test(path)),
  );
  const problems: string[] = [];
  for (const { path, text } of files) {
    if (!typescriptFile.test(path)) continue;
    const checked = frameworkCode(path) ? project(path) : undefined;
    const inspect = (node: ts.Node): void => {
      const reference = moduleReference(node);
      if (reference) {
        const target = resolve(path, reference)?.resolvedFileName;
        if (target && relative(process.cwd(), target).split(sep)[0] === "examples")
          problems.push(
            `${path}:${lineOf(node)}: framework module depends on an example application`,
          );
      }
      if (checked && rawEventFilter(node, checked.checker, extensions))
        problems.push(
          `${path}:${lineOf(node)}: classify raw provider events in the application adapter`,
        );
    };
    if (checked) inspectTree(checked.source, inspect);
    else inspectSource(path, text, inspect);
  }
  return problems;
}

/**
 * Returns one finding per tracked file under `.changeset/`. Ichnaea keeps no Changesets: the
 * conventional commit titles on signed `main` are the change log (decision 0021, point 9).
 */
export function findChangesets(paths: readonly string[]): string[] {
  return paths
    .filter((path) => path.startsWith(".changeset/"))
    .map(
      (path) => `${path}: a changeset, but the titles on main are the change log (decision 0021)`,
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
      (typescriptFile.test(path) || /\.(json|md)$/.test(path)),
  );
  const findings = [
    ...findViolations(sources),
    ...behaviorProblems(sources, new Set(tracked.map((path) => extname(path)))),
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
