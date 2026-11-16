// The mutation harness (scripts/stats/mutants.ts) can only prove something when every mutant
// applies: its file exists and its anchor occurs exactly once. A mutant whose anchor drifted away
// from the source never runs, and an anchor that occurs twice may mutate the wrong place. This test
// checks every mutant against the sources on each run, and shows that the harness refuses to run
// when an anchor does not apply, before it changes any file.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { anchorProblems, MUTANTS, type Mutant, runMutants } from "../../scripts/stats/mutants.ts";

const root = join(import.meta.dirname, "..", "..");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
/** A scratch package root with one source file. */
function scratch(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mutants-"));
  dirs.push(dir);
  writeFileSync(join(dir, "source.ts"), text);
  return dir;
}

describe("the mutation harness", () => {
  it("has every mutant's anchor exactly once in its file", () => {
    expect(anchorProblems(MUTANTS, root)).toEqual([]);
  });

  it("names a mutant whose file is missing, whose anchor is gone, or occurs twice", () => {
    const dir = scratch("const a = 1;\nconst b = 2;\nconst b = 2;\n");
    const mutants: Mutant[] = [
      { id: "applies", file: "source.ts", from: "const a = 1;", to: "const a = 0;" },
      { id: "no file", file: "missing.ts", from: "x", to: "y" },
      { id: "stale anchor", file: "source.ts", from: "const c = 3;", to: "const c = 0;" },
      { id: "twice", file: "source.ts", from: "const b = 2;", to: "const b = 0;" },
    ];
    expect(anchorProblems(mutants, dir)).toEqual([
      "no file: missing.ts does not exist",
      "stale anchor: its anchor occurs 0 times in source.ts, not once",
      "twice: its anchor occurs 2 times in source.ts, not once",
    ]);
  });

  it("fails the run on an anchor that matches no place or two, before it changes any file", () => {
    const text = "const a = 1;\nconst b = 2;\nconst b = 2;\n";
    const dir = scratch(text);
    const lines: string[] = [];
    const code = runMutants(
      [
        { id: "applies", file: "source.ts", from: "const a = 1;", to: "const a = 0;" },
        { id: "broken", file: "source.ts", from: "const a = 2;", to: "const a = 0;" },
        { id: "duplicate", file: "source.ts", from: "const b = 2;", to: "const b = 0;" },
      ],
      dir,
      [],
      (line) => lines.push(line),
    );
    expect(code).toBe(1);
    expect(lines).toEqual([
      "broken: its anchor occurs 0 times in source.ts, not once",
      "duplicate: its anchor occurs 2 times in source.ts, not once",
      "2 mutant(s) cannot apply: update them before running any",
    ]);
    // Nothing was mutated, so no test run could have been started against a changed source.
    expect(readFileSync(join(dir, "source.ts"), "utf8")).toBe(text);
  });

  it("fails the run on a duplicate anchor alone", () => {
    const dir = scratch("const b = 2;\nconst b = 2;\n");
    const lines: string[] = [];
    const duplicate: Mutant = { id: "duplicate", file: "source.ts", from: "const b = 2;", to: "x" };
    expect(runMutants([duplicate], dir, [], (line) => lines.push(line))).toBe(1);
    expect(lines[0]).toBe("duplicate: its anchor occurs 2 times in source.ts, not once");
  });
});
