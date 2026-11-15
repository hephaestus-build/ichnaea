// REQ-03, REQ-04: RFC 8785 canonical form and SHA-256 digests, checked against the RFC's own
// examples, an independent implementation, and node:crypto.
import { createHash } from "node:crypto";

import canonicalizeOracle from "canonicalize";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { canonicalize, digest, NonJsonValueError, RECORD_CONTRACTS, sha256 } from "../src/index.ts";
import { arbitraryFor } from "./support/arbitrary.ts";

const oracle = canonicalizeOracle as unknown as (value: unknown) => string;

describe("RFC 8785 canonical form", () => {
  it("matches the RFC 8785 § 3.2.2 example", () => {
    const input = {
      // The RFC writes this literal with more digits than a double holds; that is the point.
      // oxlint-disable-next-line no-loss-of-precision
      numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
      string: String.fromCharCode(
        0x20ac,
        0x24,
        0x0f,
        0x0a,
        0x41,
        0x27,
        0x42,
        0x22,
        0x5c,
        0x5c,
        0x22,
        0x2f,
      ),
      literals: [null, true, false],
    };
    expect(canonicalize(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it("sorts members by UTF-16 code units (RFC 8785 § 3.2.3 example)", () => {
    const names = [0x20ac, 0x0d, 0xfb33, 0x31, [0xd83d, 0xde00], 0x80, 0xf6].map((c) =>
      Array.isArray(c) ? String.fromCharCode(...c) : String.fromCharCode(c),
    );
    const input = Object.fromEntries(names.map((n, i) => [n, i]));
    const order = [...canonicalize(input).matchAll(/"((?:[^"\\]|\\.)*)":/g)].map(
      (m) => JSON.parse(`"${m[1]}"`) as string,
    );
    const expected = [[0x0d], [0x31], [0x80], [0xf6], [0x20ac], [0xd83d, 0xde00], [0xfb33]].map(
      (c) => String.fromCharCode(...c),
    );
    expect(order).toEqual(expected);
  });

  it.each([
    [0, "0"],
    [-0, "0"],
    [1e21, "1e+21"],
    [1e-7, "1e-7"],
    [5e-324, "5e-324"],
    [9007199254740992, "9007199254740992"],
    [295147905179352830000, "295147905179352830000"],
    [-1.7976931348623157e308, "-1.7976931348623157e+308"],
  ])("serialises the number %s as %s", (value, expected) => {
    expect(canonicalize(value)).toBe(expected);
  });

  it("agrees with an independent implementation on 1,000 generated JSON values", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(canonicalize(value)).toBe(oracle(value));
      }),
      { seed: 20261115, numRuns: 1000 },
    );
  });

  it("is independent of member order", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue({ maxDepth: 2 })), (object) => {
        const reversed = Object.fromEntries(Object.entries(object).toReversed());
        expect(canonicalize(reversed)).toBe(canonicalize(object));
      }),
      { seed: 7, numRuns: 300 },
    );
  });

  it.each([NaN, Infinity, -Infinity])("refuses the non-finite number %s (REQ-04)", (value) => {
    expect(() => canonicalize({ a: [1, value] })).toThrow(NonJsonValueError);
    expect(() => canonicalize({ a: [1, value] })).toThrow("/a/1");
  });

  it.each([[() => 1], [Symbol("s")], [10n], [new Date(0)], [new Map()]])(
    "refuses the non-JSON value %s",
    (value) => {
      expect(() => canonicalize({ v: value })).toThrow(NonJsonValueError);
    },
  );

  it("refuses circular references", () => {
    const a: Record<string, unknown> = {};
    a["self"] = a;
    expect(() => canonicalize(a)).toThrow("circular");
  });
});

describe("digests", () => {
  it("is SHA-256 over the UTF-8 canonical text", async () => {
    const value = { b: "ü", a: [1, 2.5] };
    const expected = createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
    expect(await digest(value)).toBe(`sha256:${expected}`);
    expect(await sha256("abc")).toBe(
      "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it.each(RECORD_CONTRACTS.map((c) => [c.name, c] as const))(
    "%s: equal records hash the same as a reference implementation, and output is standard JSON",
    async (_, contract) => {
      await fc.assert(
        fc.asyncProperty(arbitraryFor(contract.schema), async (record) => {
          const text = canonicalize(record);
          // REQ-04: no NaN or Infinity can appear in written output.
          expect(text).not.toMatch(/\bNaN\b|Infinity/);
          expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(record)));
          const reference = `sha256:${createHash("sha256").update(oracle(record), "utf8").digest("hex")}`;
          expect(await digest(record)).toBe(reference);
        }),
        { seed: 20261115, numRuns: 70 },
      );
    },
  );
});
