import { describe, expect, it } from "vitest";

import { checkSbom, type Shipped } from "./check-sbom.ts";
import { PROJECT } from "./tarball-project.ts";
import { tagArgument, UNTAGGED, withDownloadUrls } from "./release-sbom.ts";

const tag = "v0.1.0";
const download = (t: string, file: string) =>
  `https://github.com/hephaestus-build/ichnaea/releases/download/${t}/${file}`;
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
  url = download(tag, `scope-${name}-${version}.tgz`),
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
    expect(checkSbom(complete, shipped, tag, project)).toEqual([]);
  });

  it("fails an SBOM with no components", () => {
    expect(
      checkSbom({ bomFormat: "CycloneDX", metadata, components: [] }, shipped, tag, project),
    ).toEqual(["the SBOM lists no components"]);
    expect(checkSbom({ bomFormat: "CycloneDX", metadata }, shipped, tag, project)).toEqual([
      "the SBOM lists no components",
    ]);
    expect(
      checkSbom(
        { bomFormat: "CycloneDX", metadata, components: [{ version: "1" }] },
        shipped,
        tag,
        project,
      ),
    ).toEqual(["the SBOM has no valid component list"]);
  });

  it("fails what is not a CycloneDX SBOM", () => {
    expect(checkSbom(null, shipped, tag, project)).toEqual(["the SBOM is not CycloneDX"]);
    expect(checkSbom({ spdxVersion: "SPDX-2.3" }, shipped, tag, project)).toEqual([
      "the SBOM is not CycloneDX",
    ]);
  });

  it("fails an SBOM that misses a shipped package or has it at another version", () => {
    const missing = { ...complete, components: complete.components.slice(1) };
    expect(checkSbom(missing, shipped, tag, project)).toEqual([
      "the SBOM misses the shipped package @scope/a@0.1.0",
      "the SBOM misses @scope/a, a dependency of @scope/b",
    ]);
    const older = {
      ...complete,
      components: [component("@scope", "a", "0.0.9", "aa"), ...complete.components.slice(1)],
    };
    expect(checkSbom(older, shipped, tag, project)).toEqual([
      "the SBOM misses the shipped package @scope/a@0.1.0",
    ]);
  });

  it("fails an SBOM whose package is not the shipped tarball", () => {
    const other = {
      ...complete,
      components: [component("@scope", "a", "0.1.0", "ff"), ...complete.components.slice(1)],
    };
    expect(checkSbom(other, shipped, tag, project)).toEqual([
      "@scope/a@0.1.0 in the SBOM does not have the tarball's SHA-512",
    ]);
  });

  it("fails an SBOM that misses a dependency of a shipped package", () => {
    const noZod = { ...complete, components: complete.components.slice(0, 2) };
    expect(checkSbom(noZod, shipped, tag, project)).toEqual([
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
    expect(checkSbom(unscoped, shipped, tag, project)).toEqual([
      "the SBOM's top-level component is not pkg:npm/%40scope/release@0.1.0",
    ]);
    const otherVersion = {
      ...complete,
      metadata: { component: { ...metadata.component, version: "0.0.9" } },
    };
    expect(checkSbom(otherVersion, shipped, tag, project)).toEqual([
      "the SBOM's top-level component is not pkg:npm/%40scope/release@0.1.0",
    ]);
    expect(checkSbom({ ...complete, metadata: undefined }, shipped, tag, project)).toEqual([
      "the SBOM's top-level component is not pkg:npm/%40scope/release@0.1.0",
    ]);
  });

  it("fails an SBOM whose tarball is not at its download URL for the tag", () => {
    const withUrl = (url: string) => ({
      ...complete,
      components: [component("@scope", "a", "0.1.0", "aa", url), ...complete.components.slice(1)],
    });
    const runnerPath = "file:../../work/ichnaea/release/scope-a-0.1.0.tgz";
    expect(checkSbom(withUrl(runnerPath), shipped, tag, project)).toEqual([
      `@scope/a@0.1.0 in the SBOM is distributed at ${runnerPath}, not ${download(tag, "scope-a-0.1.0.tgz")}`,
    ]);
    const otherTag = download("v0.0.9", "scope-a-0.1.0.tgz");
    expect(checkSbom(withUrl(otherTag), shipped, tag, project)).toEqual([
      `@scope/a@0.1.0 in the SBOM is distributed at ${otherTag}, not ${download(tag, "scope-a-0.1.0.tgz")}`,
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
    expect(checkSbom(noUrl, shipped, tag, project)).toEqual([
      `@scope/a@0.1.0 in the SBOM is distributed at no URL, not ${download(tag, "scope-a-0.1.0.tgz")}`,
    ]);
  });

  it("tells an SBOM with the placeholder tag from the SBOM of a release", () => {
    const untagged = {
      ...complete,
      components: [
        component("@scope", "a", "0.1.0", "aa", download(UNTAGGED, "scope-a-0.1.0.tgz")),
        component("@scope", "b", "0.1.0", "bb", download(UNTAGGED, "scope-b-0.1.0.tgz")),
        complete.components[2],
      ],
    };
    expect(checkSbom(untagged, shipped, UNTAGGED, project)).toEqual([]);
    expect(checkSbom(untagged, shipped, tag, project)).toHaveLength(2);
    expect(checkSbom(complete, shipped, UNTAGGED, project)).toHaveLength(2);
  });

  it("names the release project in the release's own npm scope by default", () => {
    expect(PROJECT).toBe("@hephaestus-build/ichnaea-release");
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
  it("gives each tarball its download URL for the tag instead of its path on the build machine", () => {
    expect(withDownloadUrls(pnpmSbom(), tag, ["scope-a-0.1.0.tgz"])).toEqual({
      components: [
        {
          name: "a",
          externalReferences: [
            { type: "distribution", url: download(tag, "scope-a-0.1.0.tgz") },
            { type: "vcs", url: "git+https://example.org/a.git" },
          ],
        },
        pnpmSbom().components[1],
      ],
    });
  });

  it("refuses a path that is not a shipped tarball", () => {
    expect(() => withDownloadUrls(pnpmSbom(), tag, ["scope-b-0.1.0.tgz"])).toThrow(
      "the SBOM has a path that is not a shipped tarball: file:../../../runner/release/scope-a-0.1.0.tgz",
    );
  });

  it("uses the placeholder tag only when no tag is given", () => {
    expect(tagArgument(undefined)).toBe(UNTAGGED);
    expect(tagArgument("v0.1.0")).toBe("v0.1.0");
    expect(() => tagArgument("")).toThrow("release tag  is not v0.x.y");
    expect(() => tagArgument(UNTAGGED)).toThrow("is not v0.x.y");
  });
});
