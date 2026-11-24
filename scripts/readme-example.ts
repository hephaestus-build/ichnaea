// Reads the install and the five-minute example of the README: the install's shell block, the
// example's shell block, and the table of the verdict line and exit code that each scenario
// expects. The build consumer test (scripts/build-consumer.ts) installs with the install block, runs
// the example block and checks the table, so the README is the only place that states how to
// install and what the example gives.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const INSTALL_MARKER = "<!-- The build consumer test runs this install. -->";
export const BLOCK_MARKER = "<!-- The build consumer test runs this example. -->";
export const TABLE_MARKER =
  "<!-- The build consumer test checks these verdict lines and exit codes. -->";

/** The package, by its name on npm. */
export const PACKAGE_NAME = "@tumaet/ichnaea";

/**
 * The install block's last command: it checks the registry signatures and the provenance of what
 * was installed. The consumer test runs it in pnpm's layout. With a packed tarball it checks only
 * zod, because npm skips a package that is not from the registry; with a published version it
 * also checks the package's own provenance.
 */
export const AUDIT = "npm audit signatures";

/**
 * The zod version that the workspace builds and tests with: the package's development dependency.
 * A consumer installs the same version.
 */
export function workspaceZod(): string {
  const manifest = JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "packages", "ichnaea", "package.json"), "utf8"),
  ) as { devDependencies: { zod: string } };
  return manifest.devDependencies.zod;
}

export interface Scenario {
  readonly scenario: string;
  /** The candidate's results file, which names the import command of the scenario. */
  readonly results: string;
  /** The run that the scenario's import command writes. */
  readonly run: string;
  /** The line that `decide` prints, and the verdict at its start. */
  readonly line: string;
  readonly verdict: string | null;
  readonly exit: number;
}

export interface Example {
  /** The commands of the block, as written. A command keeps its continuation lines. */
  readonly commands: readonly string[];
  readonly scenarios: readonly Scenario[];
}

function linesAfter(lines: readonly string[], marker: string): readonly string[] {
  const at = lines.findIndex((l) => l.trim() === marker);
  if (at < 0) throw new Error(`README.md has no line ${marker}`);
  // Blank lines separate the marker from its block or table.
  let start = at + 1;
  while (lines[start]?.trim() === "") start += 1;
  return lines.slice(start);
}

/** The lines inside the fenced block that follows a marker. */
function blockAfter(lines: readonly string[], marker: string, lang: string): readonly string[] {
  const block = linesAfter(lines, marker);
  if (block[0] !== `\`\`\`${lang}`)
    throw new Error(`the block after ${marker} must start with \`\`\`${lang}`);
  const end = block.indexOf("```");
  if (end < 0) throw new Error(`the block after ${marker} has no end`);
  return block.slice(1, end);
}

function commandsOf(block: readonly string[]): string[] {
  const commands: string[] = [];
  let open: string[] = [];
  for (const line of block) {
    if (open.length === 0 && (line.trim() === "" || line.trim().startsWith("#"))) continue;
    open.push(line);
    if (!line.endsWith("\\")) {
      commands.push(open.join("\n"));
      open = [];
    }
  }
  if (open.length > 0) throw new Error("a shell block of the README ends inside a command");
  return commands;
}

const cell = (text: string): string => text.trim().replace(/^`(.*)`$/, "$1");

/** Reads the example from the text of README.md, and fails if a scenario has no commands. */
export function readmeExample(readme: string): Example {
  const lines = readme.split("\n");
  const commands = commandsOf(blockAfter(lines, BLOCK_MARKER, "sh"));
  const rows = linesAfter(lines, TABLE_MARKER);
  const end = rows.findIndex((l) => !l.startsWith("|"));
  // The first two rows are the header and its separator.
  const scenarios = rows.slice(2, end < 0 ? rows.length : end).map((row): Scenario => {
    const [scenario = "", results = "", line = "", exit = ""] = row
      .split("|")
      .slice(1, -1)
      .map(cell);
    const imported = commands.find((c) => /\bimport\b/.test(c) && c.includes(` ${results} `));
    const run = /--run ([\w-]+)/.exec(imported ?? "")?.[1];
    if (!run) throw new Error(`no import command of the example reads ${results}`);
    if (!commands.some((c) => decides(c, run)))
      throw new Error(`no decide command of the example decides run ${run}`);
    const label = /^([A-Z]+(?:-[A-Z]+)*): /.exec(line)?.[1];
    if (!label) throw new Error(`"${line}" does not start with a verdict`);
    if (!/^\d+$/.test(exit)) throw new Error(`"${exit}" is not an exit code`);
    return {
      scenario,
      results,
      run,
      line,
      verdict: label === "ESTIMATE-ONLY" ? null : label,
      exit: Number(exit),
    };
  });
  if (scenarios.length === 0) throw new Error("the example table has no scenario");
  return { commands, scenarios };
}

/** Whether a command of the block is the `decide` of a run. */
export function decides(command: string, run: string): boolean {
  return new RegExp(`\\bdecide\\b.*--run ${run}(\\s|$)`).test(command);
}

export interface Install {
  /** The commands of the install block, as written. */
  readonly commands: readonly string[];
  /** The block's one `pnpm add` command, which adds the package and zod. */
  readonly add: string;
  /** The packages that the `pnpm add` command adds, by name, without a version. */
  readonly added: readonly string[];
}

/** The arguments of a command that are not options. */
const operands = (command: string): string[] =>
  command
    .replace(/\\\n/g, " ")
    .split(/\s+/)
    .slice(2)
    .filter((arg) => arg !== "" && !arg.startsWith("-"));

/** Reads the install from the text of README.md. */
export function readmeInstall(readme: string): Install {
  const lines = readme.split("\n");
  const commands = commandsOf(blockAfter(lines, INSTALL_MARKER, "sh"));
  const adds = commands.filter((c) => /^pnpm add\b/.test(c));
  const [add] = adds;
  if (add === undefined || adds.length > 1)
    throw new Error(`the install block has ${adds.length} pnpm add commands, not one`);
  if (commands.indexOf(AUDIT) < commands.indexOf(add))
    throw new Error(`the install block does not run ${AUDIT} after its pnpm add`);
  // A package with its version, `zod@4.6.7`, or the package by its name alone.
  const added = operands(add).map((arg) => arg.replace(/(.)@[^@]*$/, "$1"));
  return { commands, add, added };
}

/**
 * The commands that the consumer test runs: the install block with `spec`, quoted, in place of the
 * package's name in its `pnpm add`.
 */
export function installCommands(install: Install, spec: string): string[] {
  const add = install.add
    .split(" ")
    .map((arg) => (arg === PACKAGE_NAME ? `'${spec}'` : arg))
    .join(" ");
  if (add === install.add) throw new Error(`the README's pnpm add does not add ${PACKAGE_NAME}`);
  return install.commands.map((c) => (c === install.add ? add : c));
}

/** The files of the example that its block copies into the project: the `$example/<file>.ts`. */
export function copiedSources(example: Example): string[] {
  return example.commands
    .filter((c) => c.startsWith("cp "))
    .flatMap((c) => [...c.matchAll(/\$example\/([\w.-]+\.ts)\b/g)].map((m) => m[1]!));
}

/** The packages that a source file imports by name: neither `node:` nor a relative path. */
export function importedPackages(source: string): string[] {
  const specifiers = [...source.matchAll(/(?:\bfrom|^\s*import)\s+["']([^"']+)["']/gm)].map(
    (m) => m[1]!,
  );
  return [
    ...new Set(
      specifiers
        .filter((s) => !s.startsWith(".") && !s.startsWith("node:"))
        .map((s) =>
          s
            .split("/")
            .slice(0, s.startsWith("@") ? 2 : 1)
            .join("/"),
        ),
    ),
  ];
}

/**
 * The packages that the example's copied files import and that the README's install does not add.
 * pnpm gives a project file access only to the project's own dependencies, so each one fails the
 * example. `source` reads a file of the example by name.
 */
export function missingFromInstall(readme: string, source: (file: string) => string): string[] {
  const { added } = readmeInstall(readme);
  return copiedSources(readmeExample(readme))
    .flatMap((file) => importedPackages(source(file)).map((name) => ({ file, name })))
    .filter(({ name }) => !added.includes(name))
    .map(({ file, name }) => `${file} imports ${name}, which the README's pnpm add leaves out`);
}
