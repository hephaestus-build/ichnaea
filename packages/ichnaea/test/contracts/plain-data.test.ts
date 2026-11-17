// The plain-data rule for authored configuration: a loader refuses, with its field path, every value
// that JSON.stringify would drop or change. The records themselves validate JSON values only.
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { plainDataProblems } from "../../src/contracts/index.ts";

class Settings {
  limit = 0.05;
}
class Stages extends Array<string> {}

describe("plainDataProblems", () => {
  it("finds nothing in plain JSON data", () => {
    expect(
      plainDataProblems({ a: [1, "x", true, null, { b: -0.5 }], c: Object.create(null) }),
    ).toEqual([]);
  });

  it.each([
    ["a Map", new Map([["k", 1]]), "Map"],
    ["a Set", new Set([1]), "Set"],
    ["a Date", new Date("2026-11-16T00:00:00Z"), "Date"],
    ["a regular expression", /x/, "RegExp"],
    ["a class instance", new Settings(), "an instance of Settings"],
    ["an Array subclass", Stages.from(["search"]), "an instance of Stages"],
    ["undefined", undefined, "undefined"],
    ["NaN", Number.NaN, "NaN"],
    ["Infinity", Number.POSITIVE_INFINITY, "Infinity"],
    ["minus Infinity", Number.NEGATIVE_INFINITY, "-Infinity"],
    ["a symbol", Symbol("s"), "a symbol"],
    ["a function", () => 1, "a function"],
    ["a bigint", 1n, "a bigint"],
  ])("names %s with its quoted field path", (_, value, what) => {
    expect(plainDataProblems({ measures: { grounded: { limit: value } } })).toEqual([
      `"/measures/grounded/limit": ${what}`,
    ]);
  });

  it("names a value inside an array by its index, and a sparse array's hole", () => {
    // oxlint-disable-next-line no-sparse-arrays
    expect(plainDataProblems({ stages: ["search", , Number.NaN] })).toEqual([
      '"/stages/1": a hole in a sparse array',
      '"/stages/2": NaN',
    ]);
  });

  it("names an extra property and a symbol key on an array", () => {
    const stages = Object.assign(["search"], { extra: 2, [Symbol("s")]: 1 });
    expect(plainDataProblems({ stages })).toEqual([
      '"/stages/extra": a member of an array',
      '"/stages": a symbol key',
    ]);
  });

  it("names a cycle once, at the member that closes it", () => {
    const suite: Record<string, unknown> = { id: "answers" };
    suite["self"] = suite;
    expect(plainDataProblems(suite)).toEqual(['"/self": a cycle']);
  });

  it("allows one object at two places, which JSON writes twice", () => {
    const shared = { k: 5 };
    expect(plainDataProblems({ a: shared, b: shared })).toEqual([]);
  });

  it("names a symbol key and escapes a path segment as a JSON Pointer does", () => {
    expect(plainDataProblems({ [Symbol("k")]: 1, "a/b~c": Number.NaN })).toEqual([
      '"/a~1b~0c": NaN',
      '"": a symbol key',
    ]);
  });

  it("names the root by the empty pointer, apart from a member whose key is empty", () => {
    expect(plainDataProblems(new Map())).toEqual(['"": Map']);
    expect(plainDataProblems({ "": undefined })).toEqual(['"/": undefined']);
  });

  it("accepts plain objects and arrays from another realm", () => {
    const value = runInNewContext('({ a: [1, { b: "x" }], c: Object.create(null) })') as unknown;
    expect(plainDataProblems(value)).toEqual([]);
    expect(plainDataProblems(runInNewContext("new Map()"))).toEqual(['"": Map']);
  });

  it("checks a shared object once, so deep sharing stays fast", () => {
    let node: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 40; i++) node = { a: node, b: node };
    const started = performance.now();
    expect(plainDataProblems(node)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("reports at most 100 problems, then how many more", () => {
    const started = performance.now();
    const holes: unknown[] = [];
    holes.length = 5_000_000;
    const problems = plainDataProblems({ holes });
    expect(problems).toHaveLength(101);
    expect(problems[100]).toBe("and 4999900 more");
    expect(performance.now() - started).toBeLessThan(3000);
  });
});
