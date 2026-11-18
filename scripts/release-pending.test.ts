import { describe, expect, it } from "vitest";

import { pendingTags, publishedVersions } from "./release-pending.ts";

const tags = ["v0.1.0", "v0.2.0-rc.1", "v0.2.0", "v0.3.0", "build-1", "vnext"];

describe("the pending releases", () => {
  it("are the tags whose version is on npm and that have no GitHub release, oldest first", () => {
    expect(
      pendingTags({
        tags,
        published: new Set(["0.3.0", "0.1.0", "0.2.0-rc.1", "0.2.0"]),
        released: new Set(["v0.1.0"]),
      }),
    ).toEqual(["v0.2.0-rc.1", "v0.2.0", "v0.3.0"]);
  });

  it("leave out a rejected version, which npm never lists, so it gets no release", () => {
    // v0.3.0 was staged and rejected: npm lists only the versions that an owner approved.
    expect(
      pendingTags({ tags, published: new Set(["0.2.0"]), released: new Set(["v0.2.0"]) }),
    ).toEqual([]);
    expect(() =>
      pendingTags({
        tags,
        published: new Set(["0.2.0"]),
        released: new Set(),
        requested: "v0.3.0",
      }),
    ).toThrow("0.3.0 is not published on npm");
  });

  it("leave out a version that is only staged, which npm does not list", () => {
    expect(
      pendingTags({ tags, published: new Set(["0.1.0"]), released: new Set(["v0.1.0"]) }),
    ).toEqual([]);
  });

  it("are the requested tag alone, once its version is on npm", () => {
    const published = new Set(["0.1.0", "0.2.0"]);
    expect(pendingTags({ tags, published, released: new Set(), requested: "v0.2.0" })).toEqual([
      "v0.2.0",
    ]);
    expect(
      pendingTags({ tags, published, released: new Set(["v0.2.0"]), requested: "v0.2.0" }),
    ).toEqual([]);
  });

  it("refuse a requested tag that is not approved on npm, does not exist, or is no version", () => {
    const input = { tags, published: new Set(["0.1.0"]), released: new Set<string>() };
    expect(() => pendingTags({ ...input, requested: "v0.3.0" })).toThrow(
      "0.3.0 is not published on npm: approve the staged version on npmjs.com first",
    );
    expect(() => pendingTags({ ...input, requested: "v0.4.0" })).toThrow(
      "the tag v0.4.0 does not exist",
    );
    expect(() => pendingTags({ ...input, requested: "vnext" })).toThrow(
      "release tag vnext is not v0.<minor>.<patch>[-<pre-release>]",
    );
  });
});

describe("the published versions", () => {
  it("read npm view's list, its one version, or nothing for a package that is not on npm", () => {
    expect(publishedVersions({ status: 0, stdout: '["0.1.0","0.2.0"]', stderr: "" })).toEqual(
      new Set(["0.1.0", "0.2.0"]),
    );
    expect(publishedVersions({ status: 0, stdout: '"0.1.0"', stderr: "" })).toEqual(
      new Set(["0.1.0"]),
    );
    expect(publishedVersions({ status: 1, stdout: "", stderr: "npm error code E404" })).toEqual(
      new Set(),
    );
  });

  it("refuse any other answer", () => {
    expect(() => publishedVersions({ status: 1, stdout: "", stderr: "ETIMEDOUT" })).toThrow(
      "npm view failed: ETIMEDOUT",
    );
    expect(() => publishedVersions({ status: 0, stdout: "{}", stderr: "" })).toThrow(
      "npm view gave no version list",
    );
  });
});
