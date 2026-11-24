// The README's commands run as written, so the README cannot drift from the code. The test parses
// the `sh` blocks of README.md: a line that starts with `pnpm exec ichnaea` is one command (a
// trailing backslash continues it), and a trailing `# exit <n>` is the exit code it must give (0
// when absent). Each command runs in this directory, as the README says.
import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { main } from "@tumaet/ichnaea";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = join(import.meta.dirname, "..");
const readme = readFileSync(join(here, "README.md"), "utf8");
const store = join(here, ".ichnaea");
const PREFIX = "pnpm exec ichnaea ";

interface Command {
  readonly argv: string[];
  readonly exit: number;
}

/** The commands of every `sh` block in the README, in order. */
function commandsOf(markdown: string): Command[] {
  const blocks = [...markdown.matchAll(/^```sh\n([\s\S]*?)^```$/gm)].map((m) => m[1] as string);
  return blocks
    .flatMap((block) => block.replaceAll("\\\n", " ").split("\n"))
    .filter((line) => line.startsWith(PREFIX))
    .map((line) => {
      const [text = "", comment] = line.split(" # ");
      const exit = /^exit (\d+)$/.exec(comment ?? "");
      return { argv: text.slice(PREFIX.length).trim().split(/\s+/), exit: Number(exit?.[1] ?? 0) };
    });
}

/** The verdict a run stored. */
const verdictOf = (run: string): string =>
  (
    JSON.parse(readFileSync(join(store, "runs", run, "verdict.json"), "utf8")) as {
      verdict: string;
    }
  ).verdict;

describe("the example's README", () => {
  const commands = commandsOf(readme);
  const cwd = process.cwd();
  beforeAll(async () => {
    await rm(store, { recursive: true, force: true });
    process.chdir(here);
  });
  afterAll(async () => {
    process.chdir(cwd);
    await rm(store, { recursive: true, force: true });
  });

  it("gives the three commands for each of the two scenarios", () => {
    expect(commands.map((c) => c.argv[0])).toEqual([
      "import",
      "decide",
      "report",
      "import",
      "decide",
      "report",
    ]);
    expect(commands.map((c) => c.exit)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("runs as written and produces estimates for both imported candidates", async () => {
    const out: string[] = [];
    for (const { argv, exit } of commands) {
      const code = await main(argv, (t) => void out.push(t));
      expect(code, `${argv.join(" ")}\n${out.join("\n")}`).toBe(exit);
    }
    expect(verdictOf("same")).toBeNull();
    expect(verdictOf("regressed")).toBeNull();
    // The README quotes the line decide prints for the same candidate, word for word.
    const printed =
      "ESTIMATE-ONLY: Estimate-only: the run has no locked randomized assignments. It reports estimates, intervals, differences and flips without a verdict.";
    expect(out).toContain(printed);
    expect(readme.replaceAll(/\s+/g, " ")).toContain(`\`${printed}\``);
    expect(out.filter((entry) => entry.startsWith("ESTIMATE-ONLY:"))).toHaveLength(2);
    // Each file the README says a run writes exists for both runs.
    for (const file of [
      "decision.json",
      "verdict.json",
      "report/summary.md",
      "report/report.html",
    ]) {
      expect(readme).toContain(`.ichnaea/runs/<run>/${file}`);
      for (const run of ["same", "regressed"])
        expect(existsSync(join(store, "runs", run, file)), `${run}/${file}`).toBe(true);
    }
  });
});
