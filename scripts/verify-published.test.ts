import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { hasProvenance, provenanceProblems, sha512Hex } from "./verify-published.ts";

const tarball = Buffer.from("a tarball");
const hex = createHash("sha512").update(tarball).digest("hex");
const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;

const commit = "0123456789abcdef0123456789abcdef01234567";

const statement = (
  overrides: { ref?: string; path?: string; digest?: string; gitCommit?: string } = {},
) => ({
  _type: "https://in-toto.io/Statement/v1",
  subject: [
    { name: "pkg:npm/%40tumaet/ichnaea@0.2.0", digest: { sha512: overrides.digest ?? hex } },
  ],
  predicateType: "https://slsa.dev/provenance/v1",
  predicate: {
    buildDefinition: {
      externalParameters: {
        workflow: {
          ref: overrides.ref ?? "refs/tags/v0.2.0",
          repository: "https://github.com/hephaestus-build/ichnaea",
          path: overrides.path ?? ".github/workflows/release.yml",
        },
      },
      resolvedDependencies: [
        {
          uri: `git+https://github.com/hephaestus-build/ichnaea@${overrides.ref ?? "refs/tags/v0.2.0"}`,
          digest: { gitCommit: overrides.gitCommit ?? commit },
        },
      ],
    },
    runDetails: { builder: { id: "https://github.com/actions/runner/github-hosted" } },
  },
});

const bundle = (predicateType: string, payload: unknown) => ({
  predicateType,
  bundle: {
    dsseEnvelope: { payload: Buffer.from(JSON.stringify(payload)).toString("base64") },
  },
});

const audit = (provenance: unknown = statement()) => ({
  invalid: [],
  missing: [],
  verified: [
    { name: "zod", version: "4.6.7" },
    {
      name: "@tumaet/ichnaea",
      version: "0.2.0",
      attestations: { provenance: { predicateType: "https://slsa.dev/provenance/v1" } },
      attestationBundles: [
        bundle("https://github.com/npm/attestation/tree/main/specs/publish/v0.1", {}),
        bundle("https://slsa.dev/provenance/v1", provenance),
      ],
    },
  ],
});

const expected = { tag: "v0.2.0", sha512: hex, commit };

describe("the provenance of a published version", () => {
  it("names this repository's release workflow, the tag and the tarball's SHA-512", () => {
    expect(provenanceProblems(audit(), expected)).toEqual([]);
  });

  it("fails another workflow, another ref or another tarball", () => {
    expect(
      provenanceProblems(audit(statement({ path: ".github/workflows/x.yml" })), expected),
    ).toEqual([
      "the provenance names the workflow https://github.com/hephaestus-build/ichnaea " +
        ".github/workflows/x.yml at refs/tags/v0.2.0, not https://github.com/hephaestus-build/ichnaea " +
        ".github/workflows/release.yml at refs/tags/v0.2.0",
    ]);
    const branch = provenanceProblems(audit(statement({ ref: "refs/heads/main" })), expected);
    expect(branch).toHaveLength(2);
    expect(branch[1]).toBe(
      `the provenance names the source none, not ${commit}, the commit of v0.2.0`,
    );
    expect(provenanceProblems(audit(statement({ digest: "00" })), expected)).toEqual([
      "the provenance's subject is not pkg:npm/%40tumaet/ichnaea@0.2.0 with the staged SHA-512",
    ]);
  });

  it("fails a provenance of another commit than the tag's", () => {
    expect(provenanceProblems(audit(statement({ gitCommit: "f".repeat(40) })), expected)).toEqual([
      `the provenance names the source ${"f".repeat(40)}, not ${commit}, the commit of v0.2.0`,
    ]);
    const none = statement();
    none.predicate.buildDefinition.resolvedDependencies = [];
    expect(provenanceProblems(audit(none), expected)).toEqual([
      `the provenance names the source none, not ${commit}, the commit of v0.2.0`,
    ]);
  });

  it("fails a version without provenance, and any invalid or missing signature", () => {
    const none = audit();
    none.verified[1] = { name: "@tumaet/ichnaea", version: "0.2.0" };
    expect(provenanceProblems(none, expected)).toEqual([
      "npm audit signatures shows no provenance for @tumaet/ichnaea@0.2.0",
    ]);
    expect(
      provenanceProblems({ ...audit(), missing: [{ name: "zod", version: "4.6.7" }] }, expected),
    ).toEqual(["npm audit signatures found a missing signature: zod@4.6.7"]);
    expect(provenanceProblems({ verified: "x" }, expected)).toEqual([
      "npm audit signatures gave no list of verified packages",
    ]);
  });
});

describe("the SHA-512 of an integrity", () => {
  it("is the hex digest of an npm sha512 integrity, and nothing else is one", () => {
    expect(sha512Hex(integrity)).toBe(hex);
    expect(() => sha512Hex("sha1-abc")).toThrow("sha1-abc is not a sha512 integrity");
  });
});

describe("the provenance that a consumer's audit shows", () => {
  it("is there when the audit lists the version with an SLSA provenance, in any layout", () => {
    expect(hasProvenance(audit(), "0.2.0")).toBe(true);
    expect(hasProvenance(audit(), "0.2.1")).toBe(false);
    const none = audit();
    none.verified[1] = { name: "@tumaet/ichnaea", version: "0.2.0" };
    expect(hasProvenance(none, "0.2.0")).toBe(false);
    expect(hasProvenance("not an audit", "0.2.0")).toBe(false);
  });
});
