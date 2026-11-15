// Reads the five-minute example of the README: its shell block, and the table of the verdict line
// and exit code that each scenario expects. The tarball smoke test runs the block and checks the
// table, so the README is the only place that states what the example gives.

export const BLOCK_MARKER =
  "<!-- The tarball smoke test runs this block on the packed tarballs. -->";
export const TABLE_MARKER =
  "<!-- The tarball smoke test checks these verdict lines and exit codes. -->";

export interface Scenario {
  readonly scenario: string;
  /** The candidate's results file, which names the import command of the scenario. */
  readonly results: string;
  /** The run that the scenario's import command writes. */
  readonly run: string;
  /** The line that `decide` prints, and the verdict at its start. */
  readonly line: string;
  readonly verdict: string;
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

function commandsOf(lines: readonly string[]): string[] {
  if (lines[0] !== "```sh") throw new Error("the example block must follow its marker as ```sh");
  const end = lines.indexOf("```");
  if (end < 0) throw new Error("the example block has no end");
  const commands: string[] = [];
  let open: string[] = [];
  for (const line of lines.slice(1, end)) {
    if (open.length === 0 && (line.trim() === "" || line.trim().startsWith("#"))) continue;
    open.push(line);
    if (!line.endsWith("\\")) {
      commands.push(open.join("\n"));
      open = [];
    }
  }
  if (open.length > 0) throw new Error("the example block ends inside a command");
  return commands;
}

const cell = (text: string): string => text.trim().replace(/^`(.*)`$/, "$1");

/** Reads the example from the text of README.md, and fails if a scenario has no commands. */
export function readmeExample(readme: string): Example {
  const lines = readme.split("\n");
  const commands = commandsOf(linesAfter(lines, BLOCK_MARKER));
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
    const verdict = /^([A-Z]+): /.exec(line)?.[1];
    if (!verdict) throw new Error(`"${line}" does not start with a verdict`);
    if (!/^\d+$/.test(exit)) throw new Error(`"${exit}" is not an exit code`);
    return { scenario, results, run, line, verdict, exit: Number(exit) };
  });
  if (scenarios.length === 0) throw new Error("the example table has no scenario");
  return { commands, scenarios };
}

/** Whether a command of the block is the `decide` of a run. */
export function decides(command: string, run: string): boolean {
  return new RegExp(`\\bdecide\\b.*--run ${run}(\\s|$)`).test(command);
}
