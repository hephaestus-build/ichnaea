import { describe, expect, it } from "vitest";

import { checkBuildSbom, checkSbom, type Shipped } from "./check-sbom.ts";
import { PROJECT, registryUrl } from "./tarball-project.ts";
import { buildBom, buildSerialNumber, uuidV5, withRegistryUrls } from "./release-sbom.ts";

const registry = (name: string, version: string) =>
  `https://registry.npmjs.org/@scope/${name}/-/${name}-${version}.tgz`;
const shipped: Shipped[] = [
  {
    file: "scope-a-0.1.0.tgz",
    name: "@scope/a",
    version: "0.1.0",
    sha512: "aa",
    dependencies: ["zod"],
  },
  {
    file: "scope-b-0.1.0.tgz",
    name: "@scope/b",
    version: "0.1.0",
    sha512: "bb",
    dependencies: ["@scope/a"],
  },
];
const component = (
  group: string | undefined,
  name: string,
  version: string,
  sha512?: string,
  url = registry(name, version),
) => ({
  type: "library",
  ...(group ? { group } : {}),
  name,
  version,
  ...(sha512
    ? {
        externalReferences: [
          { type: "distribution", url, hashes: [{ alg: "SHA-512", content: sha512 }] },
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

  it("fails an SBOM whose tarball is not at its URL on the npm registry", () => {
    const withUrl = (url: string) => ({
      ...complete,
      components: [component("@scope", "a", "0.1.0", "aa", url), ...complete.components.slice(1)],
    });
    const runnerPath = "file:../../work/ichnaea/release/scope-a-0.1.0.tgz";
    expect(checkSbom(withUrl(runnerPath), shipped, project)).toEqual([
      `@scope/a@0.1.0 in the SBOM is distributed at ${runnerPath}, not ${registry("a", "0.1.0")}`,
    ]);
    const release = "https://github.com/hephaestus-build/ichnaea/releases/download/v0.1.0/x.tgz";
    expect(checkSbom(withUrl(release), shipped, project)).toEqual([
      `@scope/a@0.1.0 in the SBOM is distributed at ${release}, not ${registry("a", "0.1.0")}`,
    ]);
    const noUrl = {
      ...complete,
      components: [
        {
          ...component("@scope", "a", "0.1.0"),
          externalReferences: [
            { type: "distribution", hashes: [{ alg: "SHA-512", content: "aa" }] },
          ],
        },
        ...complete.components.slice(1),
      ],
    };
    expect(checkSbom(noUrl, shipped, project)).toEqual([
      `@scope/a@0.1.0 in the SBOM is distributed at no URL, not ${registry("a", "0.1.0")}`,
    ]);
  });

  it("names the release project in the release's own npm scope by default", () => {
    expect(PROJECT).toBe("@tumaet/ichnaea-release");
  });
});

// What `pnpm sbom` writes: a path on the build machine for a tarball, a registry URL for zod.
const pnpmSbom = () => ({
  components: [
    {
      name: "a",
      externalReferences: [
        { type: "distribution", url: "file:../../../runner/release/scope-a-0.1.0.tgz" },
        { type: "vcs", url: "git+https://example.org/a.git" },
      ],
    },
    {
      name: "zod",
      externalReferences: [
        { type: "distribution", url: "https://registry.npmjs.org/zod/-/zod-4.6.7.tgz" },
      ],
    },
  ],
});

describe("release SBOM", () => {
  const tarballs = [{ file: "scope-a-0.1.0.tgz", name: "@scope/a", version: "0.1.0" }];

  it("gives each tarball its URL on the npm registry instead of its path on the build machine", () => {
    expect(withRegistryUrls(pnpmSbom(), tarballs)).toEqual({
      components: [
        {
          name: "a",
          externalReferences: [
            { type: "distribution", url: registry("a", "0.1.0") },
            { type: "vcs", url: "git+https://example.org/a.git" },
          ],
        },
        pnpmSbom().components[1],
      ],
    });
  });

  it("refuses a path that is not a shipped tarball", () => {
    const other = [{ file: "scope-b-0.1.0.tgz", name: "@scope/b", version: "0.1.0" }];
    expect(() => withRegistryUrls(pnpmSbom(), other)).toThrow(
      "the SBOM has a path that is not a shipped tarball: file:../../../runner/release/scope-a-0.1.0.tgz",
    );
  });

  it("names the registry URL that npm serves a version's tarball from", () => {
    expect(registryUrl("@tumaet/ichnaea", "0.2.0-rc.1")).toBe(
      "https://registry.npmjs.org/@tumaet/ichnaea/-/ichnaea-0.2.0-rc.1.tgz",
    );
  });
});

describe("build SBOM", () => {
  const commit = "a".repeat(40);
  const date = "2026-11-16T10:17:00Z";
  const pkg = { name: "@scope/a", version: "0.0.0", peerDependencies: { zod: "^4.6.0" } };
  const own = {
    type: "library",
    group: "@scope",
    name: "a",
    version: "0.0.0",
    purl: "pkg:npm/%40scope/a@0.0.0",
    "bom-ref": "pkg:npm/%40scope/a@0.0.0",
    externalReferences: [
      { type: "distribution", url: "file:../scope-a-0.0.0.tgz", hashes: [] },
      { type: "vcs", url: "git+https://example.org/a.git" },
    ],
  };
  const zod = { type: "library", name: "zod", version: "4.6.7", "bom-ref": "pkg:npm/zod@4.6.7" };
  const scratch = { type: "library", name: "release", "bom-ref": "pkg:npm/release@0.0.0" };
  // What `pnpm sbom` writes for the scratch project that installs the packed tree.
  const scratchSbom = () => ({
    bomFormat: "CycloneDX",
    serialNumber: "urn:uuid:826b7c1f-90a2-498c-8c76-df81c9d35f20",
    metadata: { timestamp: "2026-11-16T09:35:24.360Z", component: scratch },
    components: [zod, own],
    dependencies: [
      { ref: "pkg:npm/release@0.0.0", dependsOn: ["pkg:npm/zod@4.6.7", own["bom-ref"]] },
      { ref: "pkg:npm/zod@4.6.7", dependsOn: [] },
      { ref: own["bom-ref"], dependsOn: ["pkg:npm/zod@4.6.7"] },
    ],
  });
  const built = () => buildBom(scratchSbom(), pkg, commit, date);

  it("computes UUID version 5 as RFC 9562 gives it", () => {
    expect(uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(
      "2ed6657d-e927-568b-95e1-2665a8aea6a2",
    );
  });

  it("derives the serial number and the timestamp from the source commit, not from the time", () => {
    const bom = built();
    expect(bom["serialNumber"]).toBe(buildSerialNumber(commit));
    expect(bom["serialNumber"]).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab]/);
    expect(buildSerialNumber("b".repeat(40))).not.toBe(bom["serialNumber"]);
    expect((bom["metadata"] as { timestamp: string }).timestamp).toBe(date);
    expect(JSON.stringify(buildBom(scratchSbom(), pkg, commit, date))).toBe(JSON.stringify(bom));
  });

  it("makes the package the top-level component, names the commit and drops the scratch project", () => {
    const bom = built() as {
      metadata: { component: { externalReferences: Array<{ type: string; url: string }> } };
      components: unknown[];
      dependencies: Array<{ ref: string }>;
    };
    expect(bom.metadata.component.externalReferences).toEqual([
      { type: "vcs", url: "git+https://example.org/a.git" },
      { type: "vcs", url: `git+https://github.com/hephaestus-build/ichnaea.git#${commit}` },
    ]);
    expect(bom.components).toEqual([zod]);
    expect(bom.dependencies.map((d) => d.ref)).toEqual([own["bom-ref"], "pkg:npm/zod@4.6.7"]);
    expect(checkBuildSbom(bom, pkg, commit, date)).toEqual([]);
  });

  it("fails a build SBOM of another commit, of another time or with a path on the machine", () => {
    const bom = built();
    expect(checkBuildSbom(bom, pkg, "b".repeat(40), date)).toEqual([
      `the SBOM's serial number is not ${buildSerialNumber("b".repeat(40))}`,
      `the SBOM's top-level component does not name the source commit ${"b".repeat(40)}`,
    ]);
    expect(checkBuildSbom(bom, pkg, commit, "2026-11-17T00:00:00Z")).toEqual([
      "the SBOM's timestamp is not 2026-11-17T00:00:00Z",
    ]);
    const local = { ...bom, components: [{ ...zod, description: "/home/runner/work/x" }] };
    expect(checkBuildSbom(local, pkg, commit, date)).toEqual([
      "the SBOM has a path on the build machine: /home/runner/work/x",
    ]);
    expect(checkBuildSbom(scratchSbom(), pkg, commit, date)).toContain(
      "the SBOM has a path on the build machine: file:../scope-a-0.0.0.tgz",
    );
  });

  it("fails a build SBOM without the peer dependency or with unsorted lists", () => {
    const bom = built() as Record<string, unknown>;
    expect(checkBuildSbom({ ...bom, components: [] }, pkg, commit, date)).toEqual([
      "the SBOM misses zod, a peer dependency of @scope/a",
    ]);
    const unsorted = { ...bom, components: [zod, { ...zod, "bom-ref": "pkg:npm/a@1" }] };
    expect(checkBuildSbom(unsorted, pkg, commit, date)).toEqual([
      "the SBOM's components are not sorted",
    ]);
  });

  it("refuses a pnpm SBOM that does not list the package", () => {
    expect(() => buildBom({ components: [zod] }, pkg, commit, date)).toThrow(
      "the SBOM does not list @scope/a@0.0.0",
    );
  });
});
