// What a test run under a mutant shows (scripts/mutation.ts): only an assertion failure, by its
// class, is a kill. This file is in the `mutants` project, which no mutated run executes.
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { UNIT_PROJECTS } from "../vitest.projects.ts";

import {
  classify,
  isAssertion,
  logName,
  type Outcome,
  runMutations,
  runTests,
} from "../scripts/mutation.ts";
import {
  type ModuleTree,
  type MutationError,
  type MutationReport,
  reportOf,
} from "../scripts/mutation-reporter.ts";

/** A frame in a test file, where an assertion raised by a test has its first own frame. */
const TEST = "at /pkg/test/stats/x.test.ts:12:3";
const error = (
  name: string,
  message: string,
  cause?: MutationError,
  frames: readonly string[] = [TEST],
): MutationError => ({
  name,
  message,
  comparison: false,
  frames,
  ...(cause === undefined ? {} : { cause }),
});
const property = (cause: MutationError): MutationError =>
  error("Error", "Property failed after 1 tests\n{ seed: 1 }\nCounterexample: [0]", cause);

/** A report in which one test failed with these errors. */
const failing = (...errors: MutationError[]): MutationReport => ({
  passed: false,
  modules: [],
  failed: [{ test: "test/x.test.ts: a test", errors }],
  suites: [],
  unhandled: [],
});

describe("what one test run under a mutant shows", () => {
  it("counts a passing run as a survivor", () => {
    expect(
      classify(0, { passed: true, modules: [], failed: [], suites: [], unhandled: [] }),
    ).toEqual({
      kind: "survived",
    });
  });

  it("counts chai's and vitest's assertion errors as kills, by class", () => {
    for (const name of ["AssertionError", "JestAssertionError"])
      expect(classify(1, failing(error(name, "expected 1 to be 2")))).toEqual({
        kind: "killed",
        by: ["test/x.test.ts: a test"],
      });
    // A `rejects` assertion: its message does not say "AssertionError", its class does.
    expect(
      classify(1, failing(error("AssertionError", 'promise resolved "-990" instead of rejecting')))
        .kind,
    ).toBe("killed");
  });

  it("counts a fast-check property that returned false, or failed an assertion, as a kill", () => {
    const returnedFalse = property(error("Error", "Property failed by returning false"));
    expect(classify(1, failing(returnedFalse)).kind).toBe("killed");
    const asserted = property(
      error("AssertionError", "expected { a: 1 } to deeply equal { a: 2 }"),
    );
    expect(classify(1, failing(asserted)).kind).toBe("killed");
  });

  it("counts a fast-check property whose predicate threw anything else as an error", () => {
    const threw = property(error("RangeError", "this table needs a seeded generator"));
    expect(isAssertion(threw)).toBe(false);
    expect(classify(1, failing(threw))).toMatchObject({ kind: "error" });
    // A property failure with no cause tells nothing either way.
    expect(isAssertion(error("Error", "Property failed after 3 tests"))).toBe(false);
  });

  it("counts an error from the code under test, which never passed through expect, as an error", () => {
    for (const name of ["TypeError", "RangeError", "IdentityError", "Error"])
      expect(classify(1, failing(error(name, "thrown by the code under test")))).toMatchObject({
        kind: "error",
        reason: expect.stringContaining("no assertion failed"),
      });
    // The class decides, not a substring of the message.
    expect(
      classify(1, failing(error("TypeError", "AssertionError is mentioned here"))),
    ).toMatchObject({
      kind: "error",
    });
  });

  it("counts a module that did not run, an unhandled error, a timeout or a missing report as an error", () => {
    expect(classify(1, undefined)).toMatchObject({ kind: "error" });
    expect(
      classify(1, {
        passed: false,
        modules: [{ module: "test/x.test.ts", errors: [error("SyntaxError", "Unexpected token")] }],
        failed: [],
        suites: [],
        unhandled: [],
      }),
    ).toMatchObject({ kind: "error", reason: expect.stringContaining("did not run") });
    expect(
      classify(1, {
        passed: false,
        modules: [],
        failed: [],
        suites: [],
        unhandled: [error("Error", "boom")],
      }),
    ).toMatchObject({ kind: "error", reason: expect.stringContaining("unhandled") });
    // A timeout is a detection, not an error: runMutations lists it and bounds its share.
    expect(classify(1, failing(error("Error", "Test timed out in 5000ms.")))).toEqual({
      kind: "timedOut",
      test: "test/x.test.ts: a test",
    });
    expect(classify(0, failing(error("AssertionError", "x")))).toMatchObject({ kind: "error" });
  });
});

describe("type errors from the typecheck pass", () => {
  const typeError = error("TypeCheckError", "'measure' is possibly 'undefined'.");
  it("leave a kill by an assertion a kill", () => {
    const report = {
      ...failing(error("AssertionError", "expected 1 to be 2")),
      unhandled: [typeError],
    };
    expect(classify(1, report).kind).toBe("killed");
  });

  it("are an error when no test failed", () => {
    expect(
      classify(1, { passed: false, modules: [], failed: [], suites: [], unhandled: [typeError] }),
    ).toMatchObject({
      kind: "error",
      reason: expect.stringContaining("does not type-check"),
    });
  });

  it("are not listed as a crash; any other unhandled error is", () => {
    const report = {
      ...failing(error("AssertionError", "x")),
      unhandled: [typeError, error("Error", "boom")],
    };
    expect(classify(1, report)).toEqual({
      kind: "killed",
      by: ["test/x.test.ts: a test"],
      alsoCrashed: ["unhandled Error: boom"],
    });
  });
});

describe("a run with an assertion failure and a crash", () => {
  it("is a kill, because an assertion detected the mutant, and lists the crash", () => {
    const report: MutationReport = {
      passed: false,
      modules: [],
      failed: [
        {
          test: "test/a.test.ts: asserts",
          errors: [error("AssertionError", "expected 1 to be 2")],
        },
        { test: "test/b.test.ts: crashes", errors: [error("TypeError", "x is not a function")] },
      ],
      suites: [],
      unhandled: [],
    };
    expect(classify(1, report)).toEqual({
      kind: "killed",
      by: ["test/a.test.ts: asserts"],
      alsoCrashed: ["test/b.test.ts: crashes: TypeError: x is not a function"],
    });
  });

  it("is an error when nothing asserted: a crash alone never kills", () => {
    expect(classify(1, failing(error("TypeError", "x is not a function")))).toMatchObject({
      kind: "error",
      reason: expect.stringContaining("no assertion failed"),
    });
  });
});

/** A test module whose nested suite's afterAll hook failed with `hook`, and whose tests all passed. */
const moduleWithHook = (hook: { name: string; message: string }): ModuleTree => ({
  moduleId: "test/x.test.ts",
  ok: () => false,
  errors: () => [],
  children: {
    allTests: () => [{ fullName: "outer > inner > a test", result: () => ({ state: "passed" }) }],
    allSuites: () => [
      { fullName: "outer", errors: () => [] },
      { fullName: "outer > inner", errors: () => [hook] },
    ],
  },
});

describe("errors of a nested suite", () => {
  it("are collected from every descendant suite", () => {
    const report = reportOf(
      [moduleWithHook({ name: "Error", message: "Hook timed out in 10000ms." })],
      [],
    );
    expect(report.suites).toEqual([
      {
        suite: "test/x.test.ts: outer > inner",
        errors: [expect.objectContaining({ name: "Error", message: "Hook timed out in 10000ms." })],
      },
    ]);
  });

  it("make a nested afterAll timeout a detection by timeout, never a survivor", () => {
    const report = reportOf(
      [moduleWithHook({ name: "Error", message: "Hook timed out in 10000ms." })],
      [],
    );
    expect(classify(1, report)).toEqual({
      kind: "timedOut",
      test: "test/x.test.ts: outer > inner",
    });
  });

  it("make any other hook error, with no assertion, a run error", () => {
    const report = reportOf([moduleWithHook({ name: "TypeError", message: "cannot close" })], []);
    expect(classify(1, report)).toMatchObject({
      kind: "error",
      reason: expect.stringContaining("outer > inner"),
    });
  });
});

describe("the sources the classifier relies on", () => {
  it("never import an assertion library, whose AssertionError would read as a kill", () => {
    const src = join(import.meta.dirname, "..", "src");
    const files = readdirSync(src, { recursive: true, encoding: "utf8" }).filter((f) =>
      /\.(ts|mts|js)$/.test(f),
    );
    expect(files.length).toBeGreaterThan(0);
    const importing = files.filter((f) =>
      /from\s+["'](node:assert|assert|chai)(\/[^"']*)?["']|require\(\s*["'](node:assert|assert|chai)/.test(
        readFileSync(join(src, f), "utf8"),
      ),
    );
    expect(importing).toEqual([]);
  });
});

/** n mutants named m0 … m(n − 1). */
const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}` }));

describe("timeouts in a mutation run", () => {
  const canary = { id: "canary" };
  const control = { id: "control" };
  /** An attempt in which the first `timeouts` mutants time out and the others are killed. */
  const attempt =
    (timeouts: number) =>
    (m: { id: string }): Outcome =>
      m === canary
        ? { kind: "survived" }
        : m === control || Number(m.id.slice(1)) >= timeouts
          ? { kind: "killed", by: ["t"] }
          : { kind: "timedOut", test: "slow" };

  it("lists a timeout as detected, and passes while timeouts are at most a tenth", () => {
    const lines: string[] = [];
    const result = runMutations({
      canary,
      control,
      mutants: ids(10),
      attempt: attempt(1),
      log: (l) => lines.push(l),
    });
    expect(result).toMatchObject({ code: 0, killed: 9, timedOut: ["m0"] });
    expect(lines).toContain("detected (timeout): m0");
  });

  it("fails the run when more than a tenth were detected only by a timeout", () => {
    const lines: string[] = [];
    const result = runMutations({
      canary,
      control,
      mutants: ids(10),
      attempt: attempt(2),
      log: (l) => lines.push(l),
    });
    expect(result.code).toBe(1);
    expect(lines).toContain("more than 10% of the mutants were detected only by a timeout");
  });
});

describe("where an assertion was raised", () => {
  const vitest =
    "at _Assertion.__VITEST_REJECTS__ (file:///r/node_modules/.pnpm/vitest@5.1.0/node_modules/vitest/dist/chunks/index.js:2178:33)";
  const chai =
    "at _Assertion.propertyGetter (file:///r/node_modules/.pnpm/chai@6.3.0/node_modules/chai/index.js:1607:27)";

  it("counts an assertion whose first file frame past the assertion library is in a test file", () => {
    // The stack of a real `rejects` assertion: vitest, chai, a frame with no file, chai, the test.
    const frames = [vitest, chai, "at Reflect.get (<anonymous>)", chai, TEST];
    expect(isAssertion(error("AssertionError", "promise resolved", undefined, frames))).toBe(true);
  });

  it("does not count an AssertionError that a runtime dependency raised from the source", () => {
    const dependency = "at check (file:///r/node_modules/some-dep/index.js:3:9)";
    const source = "at measure (/pkg/src/stats/wilson.ts:20:5)";
    const raised = error("AssertionError", "dependency invariant", undefined, [
      dependency,
      source,
      TEST,
    ]);
    expect(isAssertion(raised)).toBe(false);
    expect(classify(1, failing(raised))).toMatchObject({ kind: "error" });
    expect(isAssertion(error("AssertionError", "no stack", undefined, []))).toBe(false);
  });

  it("does not count a fast-check property whose assertion came from the source", () => {
    const fromSource = error("AssertionError", "x", undefined, ["at f (/pkg/src/core/a.ts:1:1)"]);
    expect(isAssertion(property(fromSource))).toBe(false);
  });
});

/** A run that crashes before its reporter writes anything. */
const crashed = () => ({ status: 1, stdout: "", stderr: "crashed" });

describe("a run's report file", () => {
  it("is deleted before the run, so a run that writes none never reads a stale one", () => {
    const dir = mkdtempSync(join(tmpdir(), "mutation-"));
    const stale = join(dir, `${logName("a mutant")}.json`);
    writeFileSync(
      stale,
      JSON.stringify({ passed: true, modules: [], failed: [], suites: [], unhandled: [] }),
    );
    expect(runTests(dir, ["stats"], "a mutant", crashed, dir)).toMatchObject({
      kind: "error",
      reason: expect.stringContaining("no test report"),
    });
    expect(existsSync(stale)).toBe(false);
  });
});

/** A report in which a test module itself failed with one error. */
const atModule = (message: string, name = "Error"): MutationReport => ({
  passed: false,
  modules: [{ module: "test/x.test.ts", errors: [error(name, message)] }],
  failed: [],
  suites: [],
  unhandled: [],
});

describe("a file-level hook that timed out", () => {
  it("is a detection by timeout, not a module that did not run", () => {
    expect(classify(1, atModule("Hook timed out in 10000ms."))).toEqual({
      kind: "timedOut",
      test: "test/x.test.ts",
    });
  });

  it("leaves a collection failure, or any other module error, a module that did not run", () => {
    for (const report of [
      atModule("Failed to load url ../src/x.ts", "Error"),
      atModule("Unexpected token", "SyntaxError"),
    ])
      expect(classify(1, report)).toMatchObject({
        kind: "error",
        reason: expect.stringContaining("did not run"),
      });
  });
});

describe("stack frames on Windows", () => {
  it("skip a dependency's frames with backslash separators, so a real assertion still kills", () => {
    const frames = [
      "at _Assertion.__VITEST_REJECTS__ (C:\\r\\node_modules\\.pnpm\\vitest@5.1.0\\node_modules\\vitest\\dist\\index.js:2178:33)",
      "at Reflect.get (<anonymous>)",
      "at C:\\pkg\\test\\stats\\x.test.ts:12:3",
    ];
    expect(isAssertion(error("AssertionError", "promise resolved", undefined, frames))).toBe(true);
  });

  it("still refuse an AssertionError that a Windows dependency raised from the source", () => {
    const frames = [
      "at check (C:\\r\\node_modules\\some-dep\\index.js:3:9)",
      "at measure (C:\\pkg\\src\\stats\\wilson.ts:20:5)",
    ];
    expect(isAssertion(error("AssertionError", "invariant", undefined, frames))).toBe(false);
  });
});

/** One of the package's test projects, by name. */
const named = (name: string) => UNIT_PROJECTS.find((p) => p.test?.name === name)?.test;

describe("the mutated stats project", () => {
  /**
   * Tests in the mutated project that import a study script, with the reason they stay: their
   * subject is the statistics, and the script only gives them their inputs.
   */
  const STAY = new Map([["solver-snapshot.test.ts", "its subject is src/stats/solve.ts"]]);

  it("holds no test of a study script: those live in test/stats-studies", () => {
    const dir = join(import.meta.dirname, "stats");
    const tests = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(
      (f) => f.endsWith(".test.ts") && !f.endsWith(".sim.test.ts") && f !== "mutants.test.ts",
    );
    expect(tests.length).toBeGreaterThan(0);
    const importing = tests.filter((f) =>
      /from\s+["'][^"']*scripts\/stats\//.test(readFileSync(join(dir, f), "utf8")),
    );
    expect(importing.toSorted()).toEqual([...STAY.keys()].toSorted());
  });

  it("leaves test/stats-studies out of the mutated project, and runs it in the unit suite", () => {
    expect(named("stats-studies")?.include).toEqual(["test/stats-studies/**/*.test.ts"]);
    expect(named("stats")?.include).toEqual(["test/stats/**/*.test.ts"]);
  });
});
