// REQ-03: canonical forms and digests agree with an implementation in another language (Python
// rfc8785, committed by scripts/contracts/oracle/digest_vectors.py), including the normative projections of
// the configuration identity and the case-set digest, so any language can reproduce them.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  canonicalize,
  caseDigest,
  caseSetDigest,
  configurationIdentity,
  digest,
} from "../../src/contracts/index.ts";

interface Vector {
  kind:
    | "canonical"
    | "configurationIdentity"
    | "configurationIdentityRefused"
    | "caseDigest"
    | "caseSetDigest";
  name: string;
  input: unknown;
  canonical?: string;
  digest: string;
}
const { vectors } = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "fixtures", "digests.json"), "utf8"),
) as { vectors: Vector[] };

describe("cross-language digest vectors", () => {
  it("covers every kind", () => {
    expect(new Set(vectors.map((v) => v.kind))).toEqual(
      new Set([
        "canonical",
        "configurationIdentity",
        "configurationIdentityRefused",
        "caseDigest",
        "caseSetDigest",
      ]),
    );
  });

  it.each(vectors.map((v) => [`${v.kind}: ${v.name}`, v] as const))("%s", async (_, v) => {
    switch (v.kind) {
      case "canonical":
        expect(canonicalize(v.input)).toBe(v.canonical);
        expect(await digest(v.input)).toBe(v.digest);
        break;
      case "configurationIdentity":
        expect(await configurationIdentity(v.input)).toBe(v.digest);
        break;
      case "configurationIdentityRefused":
        await expect(configurationIdentity(v.input)).rejects.toThrow();
        break;
      case "caseDigest":
        expect(await caseDigest(v.input)).toBe(v.digest);
        break;
      case "caseSetDigest":
        expect(await caseSetDigest(v.input as never)).toBe(v.digest);
        break;
    }
  });
});

const generated = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "fixtures", "digests-generated.json"), "utf8"),
) as {
  vectors: Array<{ input: unknown; canonical: string; digest: string }>;
};

describe("1,000 generated cross-language vectors (wide-range doubles, any Unicode)", () => {
  it("has 1,000 vectors", () => expect(generated.vectors).toHaveLength(1000));
  it("every canonical form and digest matches the Python implementation", async () => {
    for (const v of generated.vectors) {
      expect(canonicalize(v.input)).toBe(v.canonical);
      expect(await digest(v.input)).toBe(v.digest);
    }
  });
});
