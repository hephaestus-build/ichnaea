// REQ-03: canonical forms and digests agree with an implementation in another language (Python
// rfc8785, committed by scripts/oracle/digest_vectors.py), including the normative projections of
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
} from "../src/index.ts";

interface Vector {
  kind: "canonical" | "configurationIdentity" | "caseDigest" | "caseSetDigest";
  name: string;
  input: unknown;
  canonical?: string;
  digest: string;
}
const { vectors } = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "fixtures", "digests.json"), "utf8"),
) as { vectors: Vector[] };

describe("cross-language digest vectors", () => {
  it("covers every kind", () => {
    expect(new Set(vectors.map((v) => v.kind))).toEqual(
      new Set(["canonical", "configurationIdentity", "caseDigest", "caseSetDigest"]),
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
      case "caseDigest":
        expect(await caseDigest(v.input)).toBe(v.digest);
        break;
      case "caseSetDigest":
        expect(await caseSetDigest(v.input as never)).toBe(v.digest);
        break;
    }
  });
});
