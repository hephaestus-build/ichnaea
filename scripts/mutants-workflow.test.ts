// The mutants workflow runs every mutant script, so that no present-tense mutation claim rests on
// mutants that never run. A new mutant script that the workflow does not run fails this test.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const workflow = readFileSync(join(root, ".github", "workflows", "mutants.yml"), "utf8");
const scriptsDir = join(root, "packages", "ichnaea", "scripts");
const mutantScripts = readdirSync(scriptsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .filter((d) => readdirSync(join(scriptsDir, d.name)).includes("mutants.ts"))
  .map((d) => `scripts/${d.name}/mutants.ts`)
  .toSorted();

describe("the mutants workflow", () => {
  it("runs every mutant script of the package", () => {
    expect(mutantScripts).toEqual([
      "scripts/calibration/mutants.ts",
      "scripts/contracts/mutants.ts",
      "scripts/decide/mutants.ts",
      "scripts/stats/mutants.ts",
    ]);
    for (const script of mutantScripts) expect(workflow).toContain(`run: node ${script}\n`);
  });

  it("runs on every pull request, on main and nightly, with no path filter", () => {
    expect(workflow).toMatch(
      /\non:\n {2}pull_request:\n {2}push:\n {4}branches: \[main\]\n {2}schedule:\n/,
    );
    expect(workflow).not.toMatch(/\n {4}paths(-ignore)?:/);
  });

  it("skips a pull request only when nothing a mutant reads has changed", () => {
    for (const dir of [
      "src",
      "test",
      "scripts/calibration",
      "scripts/contracts",
      "scripts/decide",
      "scripts/stats",
    ])
      expect(workflow).toContain(`packages/ichnaea/${dir}`);
  });
});
