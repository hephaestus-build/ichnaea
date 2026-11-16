import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { latestTag, releaseTags, tagProblem } from "./check-release-tag.ts";

describe("the release tag", () => {
  it("may be the first release", () => {
    expect(tagProblem("v0.1.0", [])).toBeUndefined();
    expect(tagProblem("v0.0.1", [])).toBeUndefined();
  });

  it("is greater than every existing v* tag, as numbers and not as text", () => {
    expect(tagProblem("v0.10.0", ["v0.9.3", "v0.2.0"])).toBeUndefined();
    expect(tagProblem("v0.9.4", ["v0.9.3", "v0.10.0"])).toBe(
      "release tag v0.9.4 is not greater than v0.10.0, the greatest v* tag",
    );
    expect(tagProblem("v0.1.0", ["v0.1.1"])).toBe(
      "release tag v0.1.0 is not greater than v0.1.1, the greatest v* tag",
    );
  });

  it("is not a tag already", () => {
    expect(tagProblem("v0.2.0", ["v0.1.0", "v0.2.0"])).toBe("tag v0.2.0 exists already");
  });

  it("is v0.<minor>.<patch>, with no leading zero, pre-release or other major", () => {
    for (const tag of ["0.1.0", "v1.0.0", "v0.1", "v0.01.0", "v0.1.0-rc.1", "v0.1.0 ", ""])
      expect(tagProblem(tag, []), tag).toBe(`release tag ${tag} is not v0.<minor>.<patch>`);
  });

  it("is refused while a v* tag is not a version, because the order of releases is then unclear", () => {
    expect(tagProblem("v0.2.0", ["v0.1.0", "v0.0.0-probe", "vnext"])).toBe(
      "the v* tags v0.0.0-probe, vnext are not v<major>.<minor>.<patch>, so no release can be ordered after them",
    );
  });

  it("follows the greatest v* tag, the previous release", () => {
    expect(latestTag([])).toBeUndefined();
    expect(latestTag(["v0.9.3", "v0.10.0", "v0.2.0"])).toBe("v0.10.0");
  });
});

describe("the v* tags of a repository", () => {
  const repo = mkdtempSync(join(tmpdir(), "ichnaea-release-tag-"));
  afterAll(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args: string[]): string =>
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@example.org", "-c", "tag.gpgsign=false", ...args],
      { cwd: repo, encoding: "utf8" },
    );

  it("are read with git tag, and other tags are left out", () => {
    git("init", "--quiet", "--initial-branch=main");
    git("-c", "commit.gpgsign=false", "commit", "--quiet", "--allow-empty", "-m", "first");
    for (const tag of ["v0.1.0", "v0.10.0", "build-1"]) git("tag", tag);
    git("tag", "-a", "v0.2.0", "-m", "annotated");
    expect(releaseTags(repo).toSorted()).toEqual(["v0.1.0", "v0.10.0", "v0.2.0"]);
  });
});
