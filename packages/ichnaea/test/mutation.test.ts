// What a test run under a mutant shows (scripts/mutation.ts): only an assertion failure, by its
// class, is a kill. This file is in the `mutants` project, which no mutated run executes.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { classify, isAssertion } from "../scripts/mutation.ts";
import type { MutationError, MutationReport } from "../scripts/mutation-reporter.ts";

const error = (name: string, message: string, cause?: MutationError): MutationError => ({
  name,
  message,
  comparison: false,
  frame: "",
  ...(cause === undefined ? {} : { cause }),
});
const property = (cause: MutationError): MutationError =>
  error("Error", "Property failed after 1 tests\n{ seed: 1 }\nCounterexample: [0]", cause);

/** A report in which one test failed with these errors. */
const failing = (...errors: MutationError[]): MutationReport => ({
  passed: false,
  modules: [],
  failed: [{ test: "test/x.test.ts: a test", errors }],
  unhandled: [],
});

describe("what one test run under a mutant shows", () => {
  it("counts a passing run as a survivor", () => {
    expect(classify(0, { passed: true, modules: [], failed: [], unhandled: [] })).toEqual({
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
        reason: expect.stringContaining("without an assertion"),
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
        unhandled: [],
      }),
    ).toMatchObject({ kind: "error", reason: expect.stringContaining("did not run") });
    expect(
      classify(1, { passed: false, modules: [], failed: [], unhandled: [error("Error", "boom")] }),
    ).toMatchObject({ kind: "error", reason: expect.stringContaining("unhandled") });
    expect(classify(1, failing(error("Error", "Test timed out in 5000ms.")))).toMatchObject({
      kind: "error",
      reason: expect.stringContaining("timed out"),
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
      classify(1, { passed: false, modules: [], failed: [], unhandled: [typeError] }),
    ).toMatchObject({
      kind: "error",
      reason: expect.stringContaining("does not type-check"),
    });
  });

  it("do not excuse any other unhandled error", () => {
    const report = {
      ...failing(error("AssertionError", "x")),
      unhandled: [typeError, error("Error", "boom")],
    };
    expect(classify(1, report)).toMatchObject({
      kind: "error",
      reason: expect.stringContaining("unhandled Error"),
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
