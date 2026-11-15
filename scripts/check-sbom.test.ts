import { describe, expect, it } from "vitest";

import { checkSbom, type Shipped } from "./check-sbom.ts";
import { PROJECT } from "./consumer-project.ts";

const shipped: Shipped[] = [
  { name: "@scope/a", version: "0.1.0", sha512: "aa", dependencies: ["zod"] },
  { name: "@scope/b", version: "0.1.0", sha512: "bb", dependencies: ["@scope/a"] },
];
const component = (group: string | undefined, name: string, version: string, sha512?: string) => ({
  type: "library",
  ...(group ? { group } : {}),
  name,
  version,
  ...(sha512
    ? {
        externalReferences: [
          { type: "distribution", hashes: [{ alg: "SHA-512", content: sha512 }] },
        ],
      }
    : {}),
});
const project = "@scope/release";
const metadata = {
  component: {
    type: "library",
    group: "@scope",
    name: "release",
    version: "0.1.0",
    purl: "pkg:npm/%40scope/release@0.1.0",
  },
};
const complete = {
  bomFormat: "CycloneDX",
  metadata,
  components: [
    component("@scope", "a", "0.1.0", "aa"),
    component("@scope", "b", "0.1.0", "bb"),
    component(undefined, "zod", "4.6.6"),
  ],
};

describe("release SBOM check", () => {
  it("passes an SBOM that lists every shipped package at its digest and every dependency", () => {
    expect(checkSbom(complete, shipped, project)).toEqual([]);
  });

  it("fails an SBOM with no components", () => {
    expect(
      checkSbom({ bomFormat: "CycloneDX", metadata, components: [] }, shipped, project),
    ).toEqual(["the SBOM lists no components"]);
    expect(checkSbom({ bomFormat: "CycloneDX", metadata }, shipped, project)).toEqual([
      "the SBOM lists no components",
    ]);
    expect(
      checkSbom(
        { bomFormat: "CycloneDX", metadata, components: [{ version: "1" }] },
        shipped,
        project,
      ),
    ).toEqual(["the SBOM has no valid component list"]);
  });

  it("fails what is not a CycloneDX SBOM", () => {
    expect(checkSbom(null, shipped, project)).toEqual(["the SBOM is not CycloneDX"]);
    expect(checkSbom({ spdxVersion: "SPDX-2.3" }, shipped, project)).toEqual([
      "the SBOM is not CycloneDX",
    ]);
  });

  it("fails an SBOM that misses a shipped package or has it at another version", () => {
    const missing = { ...complete, components: complete.components.slice(1) };
    expect(checkSbom(missing, shipped, project)).toEqual([
      "the SBOM misses the shipped package @scope/a@0.1.0",
      "the SBOM misses @scope/a, a dependency of @scope/b",
    ]);
    const older = {
      ...complete,
      components: [component("@scope", "a", "0.0.9", "aa"), ...complete.components.slice(1)],
    };
    expect(checkSbom(older, shipped, project)).toEqual([
      "the SBOM misses the shipped package @scope/a@0.1.0",
    ]);
  });

  it("fails an SBOM whose package is not the shipped tarball", () => {
    const other = {
      ...complete,
      components: [component("@scope", "a", "0.1.0", "ff"), ...complete.components.slice(1)],
    };
    expect(checkSbom(other, shipped, project)).toEqual([
      "@scope/a@0.1.0 in the SBOM does not have the tarball's SHA-512",
    ]);
  });

  it("fails an SBOM that misses a dependency of a shipped package", () => {
    const noZod = { ...complete, components: complete.components.slice(0, 2) };
    expect(checkSbom(noZod, shipped, project)).toEqual([
      "the SBOM misses zod, a dependency of @scope/a",
    ]);
  });

  it("fails an SBOM whose top-level component is not the release project in its scope", () => {
    const unscoped = {
      ...complete,
      metadata: {
        component: { name: "release", version: "0.1.0", purl: "pkg:npm/release@0.1.0" },
      },
    };
    expect(checkSbom(unscoped, shipped, project)).toEqual([
      "the SBOM's top-level component is not pkg:npm/%40scope/release@0.1.0",
    ]);
    const otherVersion = {
      ...complete,
      metadata: { component: { ...metadata.component, version: "0.0.9" } },
    };
    expect(checkSbom(otherVersion, shipped, project)).toEqual([
      "the SBOM's top-level component is not pkg:npm/%40scope/release@0.1.0",
    ]);
    expect(checkSbom({ ...complete, metadata: undefined }, shipped, project)).toEqual([
      "the SBOM's top-level component is not pkg:npm/%40scope/release@0.1.0",
    ]);
  });

  it("names the release project in the release's own npm scope by default", () => {
    expect(PROJECT).toBe("@hephaestus-build/ichnaea-release");
  });
});
