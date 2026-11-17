// The mutation harness (scripts/stats/mutants.ts) can only prove something when every mutant
// applies: its file exists and its anchor occurs exactly once. A mutant whose anchor drifted away
// from the source never runs, and an anchor that occurs twice may mutate the wrong place. This test
// checks every mutant against the sources on each run, and shows that the harness refuses to run
// when an anchor does not apply, before it changes any file.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { classify, type Outcome, type VitestReport } from "../../scripts/mutation.ts";
import {
  anchorProblems,
  CANARY,
  CONTROL,
  MUTANTS,
  type Mutant,
  runMutants,
} from "../../scripts/stats/mutants.ts";
import { UNIT_PROJECTS } from "../../vitest.projects.ts";

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

/** One of the package's test projects, by name. */
const project = (name: string) => UNIT_PROJECTS.find((p) => p.test?.name === name)?.test;

/** The scratch package's controls: a comment change no test sees, and a break every test sees. */
const canary: Mutant = { id: "canary", file: "source.ts", from: "// canary", to: "// canary!" };
const control: Mutant = {
  id: "control",
  file: "source.ts",
  from: "const k = 1;",
  to: "const k = 0;",
};
const applies: Mutant = {
  id: "applies",
  file: "source.ts",
  from: "const a = 1;",
  to: "const a = 0;",
};
const SOURCE = "// canary\nconst k = 1;\nconst a = 1;\nconst z = 1;\n";
const killed: Outcome = { kind: "killed", by: ["a test"] };
const survived: Outcome = { kind: "survived" };

/** A test that reads the scratch source: it fails, by an assertion, when `k` or `a` changed. */
const behaviour = (dir: string) => (): Outcome => {
  const text = readFileSync(join(dir, "source.ts"), "utf8");
  return text.includes("const k = 1;") && text.includes("const a = 1;") ? survived : killed;
};

describe("the mutation harness", () => {
  it("has every mutant's anchor exactly once in its file, the controls' included", () => {
    expect(anchorProblems([CANARY, CONTROL, ...MUTANTS], root)).toEqual([]);
  });

  it("runs the mutants against a project that leaves out this file, whose anchor check every mutant breaks", () => {
    expect(project("stats")?.exclude).toContain("test/stats/mutants.test.ts");
    expect(project("contracts")?.exclude).toContain("test/contracts/mutants.test.ts");
    expect(project("mutants")?.include).toEqual(["test/*/mutants.test.ts"]);
  });

  it("names a mutant whose file is missing, whose anchor is gone, or occurs twice", () => {
    const dir = scratch("const a = 1;\nconst b = 2;\nconst b = 2;\n");
    const mutants: Mutant[] = [
      applies,
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
    const text = `${SOURCE}const b = 2;\nconst b = 2;\n`;
    const dir = scratch(text);
    const lines: string[] = [];
    const mutants: Mutant[] = [
      applies,
      { id: "broken", file: "source.ts", from: "const a = 2;", to: "const a = 0;" },
      { id: "duplicate", file: "source.ts", from: "const b = 2;", to: "const b = 0;" },
    ];
    const code = runMutants(
      mutants,
      dir,
      [],
      (l) => lines.push(l),
      behaviour(dir),
      canary,
      control,
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

  it("applies the canary and the control first, and then counts kills and survivors", () => {
    const dir = scratch(SOURCE);
    const lines: string[] = [];
    const missed: Mutant = {
      id: "missed",
      file: "source.ts",
      from: "const z = 1;",
      to: "const z = 0;",
    };
    const code = runMutants(
      [applies, missed],
      dir,
      [],
      (l) => lines.push(l),
      behaviour(dir),
      canary,
      control,
    );
    expect(code).toBe(1);
    expect(lines).toEqual([
      "canary: survived, as it must be",
      "control: killed, as it must be",
      "applies: killed",
      "missed: SURVIVED",
      "survivors: missed",
    ]);
    expect(readFileSync(join(dir, "source.ts"), "utf8")).toBe(SOURCE);
  });

  it("fails the run when the canary is killed: some test fails whatever the mutant does", () => {
    const dir = scratch(SOURCE);
    const lines: string[] = [];
    // A test that fails whatever the change, as the anchor check did inside the mutated project.
    const code = runMutants(
      [applies],
      dir,
      [],
      (l) => lines.push(l),
      () => killed,
      canary,
      control,
    );
    expect(code).toBe(1);
    expect(lines).toEqual([
      "canary: killed",
      "the canary was not reported surviving: this run cannot show a survivor, so no kill counts",
    ]);
    expect(readFileSync(join(dir, "source.ts"), "utf8")).toBe(SOURCE);
  });

  it("fails the run when the control survives: no test fails whatever the mutant does", () => {
    const dir = scratch(SOURCE);
    const lines: string[] = [];
    const code = runMutants(
      [applies],
      dir,
      [],
      (l) => lines.push(l),
      () => survived,
      canary,
      control,
    );
    expect(code).toBe(1);
    expect(lines).toEqual([
      "canary: survived, as it must be",
      "control: SURVIVED",
      "the deliberate break was not killed: this run cannot show a kill, so no result counts",
    ]);
  });

  it("reports an error as no result, and fails the run", () => {
    const dir = scratch(SOURCE);
    const lines: string[] = [];
    const crash = (): Outcome =>
      readFileSync(join(dir, "source.ts"), "utf8").includes("const a = 0;")
        ? { kind: "error", reason: "a suite did not run" }
        : behaviour(dir)();
    const code = runMutants([applies], dir, [], (l) => lines.push(l), crash, canary, control);
    expect(code).toBe(1);
    expect(lines.slice(2)).toEqual([
      "applies: ERROR: a suite did not run",
      "errors (no result): applies",
    ]);
  });
});

/** A vitest JSON report with one suite and the given test results. */
const report = (
  tests: { status: string; messages?: string[] }[],
  suite: { status?: string; message?: string } = {},
): VitestReport => ({
  success: tests.every((t) => t.status === "passed") && suite.status !== "failed",
  numFailedTests: tests.filter((t) => t.status === "failed").length,
  testResults: [
    {
      name: "test/stats/x.test.ts",
      status: suite.status ?? (tests.some((t) => t.status === "failed") ? "failed" : "passed"),
      message: suite.message ?? "",
      assertionResults: tests.map((t, i) => ({
        title: `test ${i}`,
        status: t.status,
        failureMessages: t.messages ?? [],
      })),
    },
  ],
});

describe("what one test run under a mutant shows", () => {
  it("counts a passing run as a survivor and an assertion failure as a kill", () => {
    expect(classify(0, report([{ status: "passed" }]))).toEqual({ kind: "survived" });
    expect(
      classify(
        1,
        report([
          { status: "passed" },
          { status: "failed", messages: ["AssertionError: expected 1 to be 2"] },
        ]),
      ),
    ).toEqual({ kind: "killed", by: ["test/stats/x.test.ts: test 1"] });
  });

  it("counts a property failure that wraps an assertion as a kill", () => {
    const wrapped =
      "Error: Property failed after 10 tests\nGot error: AssertionError: expected 0.5 to be 0.4";
    expect(classify(1, report([{ status: "failed", messages: [wrapped] }])).kind).toBe("killed");
  });

  it("counts a crash, a suite that did not load, a timeout or a missing report as an error", () => {
    expect(classify(1, undefined)).toMatchObject({ kind: "error" });
    expect(
      classify(1, report([], { status: "failed", message: "SyntaxError: Unexpected token" })),
    ).toMatchObject({ kind: "error", reason: expect.stringContaining("did not run") });
    expect(
      classify(1, report([{ status: "failed", messages: ["Error: Test timed out in 5000ms."] }])),
    ).toMatchObject({ kind: "error", reason: expect.stringContaining("timed out") });
    expect(
      classify(1, report([{ status: "failed", messages: ["TypeError: x is not a function"] }])),
    ).toMatchObject({ kind: "error", reason: expect.stringContaining("without an assertion") });
    // A failed run in which no test failed: an unhandled error.
    expect(classify(1, { ...report([{ status: "passed" }]), success: false })).toMatchObject({
      kind: "error",
    });
    // An exit code that disagrees with the report.
    expect(classify(0, report([{ status: "failed", messages: ["AssertionError"] }]))).toMatchObject(
      {
        kind: "error",
      },
    );
  });
});
