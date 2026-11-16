// The plain-data rule for authored configuration: a loader refuses, with its field path, every value
// that JSON.stringify would drop or change. The records themselves validate JSON values only.
import { describe, expect, it } from "vitest";

import { plainDataProblems } from "../../src/contracts/index.ts";

class Settings {
  limit = 0.05;
}

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
    ["undefined", undefined, "undefined"],
    ["NaN", Number.NaN, "NaN"],
    ["Infinity", Number.POSITIVE_INFINITY, "Infinity"],
    ["minus Infinity", Number.NEGATIVE_INFINITY, "-Infinity"],
    ["a symbol", Symbol("s"), "a symbol"],
    ["a function", () => 1, "a function"],
    ["a bigint", 1n, "a bigint"],
  ])("names %s with its field path", (_, value, what) => {
    expect(plainDataProblems({ measures: { grounded: { limit: value } } })).toEqual([
      `/measures/grounded/limit: ${what}`,
    ]);
  });

  it("names a value inside an array by its index, and a sparse array's hole", () => {
    // oxlint-disable-next-line no-sparse-arrays
    expect(plainDataProblems({ stages: ["search", , Number.NaN] })).toEqual([
      "/stages/1: a hole in a sparse array",
      "/stages/2: NaN",
    ]);
  });

  it("names a cycle once, at the member that closes it", () => {
    const suite: Record<string, unknown> = { id: "answers" };
    suite["self"] = suite;
    expect(plainDataProblems(suite)).toEqual(["/self: a cycle"]);
  });

  it("allows one object at two places, which JSON writes twice", () => {
    const shared = { k: 5 };
    expect(plainDataProblems({ a: shared, b: shared })).toEqual([]);
  });

  it("names a symbol key and escapes a path segment as a JSON Pointer does", () => {
    expect(plainDataProblems({ [Symbol("k")]: 1, "a/b~c": Number.NaN })).toEqual([
      "/a~1b~0c: NaN",
      "/: a symbol key",
    ]);
  });

  it("names the root itself", () => {
    expect(plainDataProblems(new Map())).toEqual(["/: Map"]);
  });
});
