import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  breakingProblem,
  commitMessages,
  compareTags,
  distTag,
  isBreaking,
  latestTag,
  previousTag,
  releaseLine,
  releaseTags,
  tagProblem,
} from "./check-release-tag.ts";

describe("the release tag", () => {
  it("may be the first release, or a first pre-release", () => {
    expect(tagProblem("v0.1.0", [])).toBeUndefined();
    expect(tagProblem("v0.0.1", [])).toBeUndefined();
    expect(tagProblem("v0.1.0-rc.1", [])).toBeUndefined();
  });

  it("is greater than every other v* tag, as numbers and not as text", () => {
    expect(tagProblem("v0.10.0", ["v0.9.3", "v0.2.0"])).toBeUndefined();
    expect(tagProblem("v0.9.4", ["v0.9.3", "v0.10.0"])).toBe(
      "release tag v0.9.4 is not greater than v0.10.0, the greatest other v* tag",
    );
    expect(tagProblem("v0.1.0", ["v0.1.1"])).toBe(
      "release tag v0.1.0 is not greater than v0.1.1, the greatest other v* tag",
    );
  });

  it("orders a pre-release before its release and after the release before it", () => {
    expect(tagProblem("v0.2.0-rc.1", ["v0.1.4"])).toBeUndefined();
    expect(tagProblem("v0.2.0-rc.2", ["v0.1.4", "v0.2.0-rc.1"])).toBeUndefined();
    expect(tagProblem("v0.2.0-rc.10", ["v0.2.0-rc.9"])).toBeUndefined();
    expect(tagProblem("v0.2.0", ["v0.1.4", "v0.2.0-rc.2"])).toBeUndefined();
    expect(tagProblem("v0.2.0-rc.3", ["v0.2.0"])).toBe(
      "release tag v0.2.0-rc.3 is not greater than v0.2.0, the greatest other v* tag",
    );
    expect(tagProblem("v0.2.0-beta.1", ["v0.2.0-rc.1"])).toMatch(/is not greater than/);
  });

  it("orders pre-releases as semver does: numbers below words, a longer list above a prefix", () => {
    const order = ["v0.1.0-1", "v0.1.0-alpha", "v0.1.0-alpha.1", "v0.1.0-alpha.beta", "v0.1.0"];
    expect(order.toSorted(compareTags)).toEqual(order);
    expect(order.toReversed().toSorted(compareTags)).toEqual(order);
  });

  it("is v0.<minor>.<patch>, with an optional pre-release, and no other major", () => {
    for (const tag of ["0.1.0", "v1.0.0", "v0.1", "v0.01.0", "v0.1.0-", "v0.1.0+b", "v0.1.0 "])
      expect(tagProblem(tag, []), tag).toBe(
        `release tag ${tag} is not v0.<minor>.<patch>[-<pre-release>]`,
      );
  });

  it("ignores a v* tag that is not a version, or not in the 0.x line, and names it", () => {
    const stray = ["v0.1.0", "vnext", "v0.0.0+x", "v1.0.0", "v2.3.4-rc.1"];
    expect(releaseLine(stray)).toEqual({
      line: ["v0.1.0"],
      ignored: ["vnext", "v0.0.0+x", "v1.0.0", "v2.3.4-rc.1"],
    });
    expect(tagProblem("v0.2.0", stray)).toBeUndefined();
    expect(latestTag(stray)).toBe("v0.1.0");
    expect(previousTag("v0.2.0", stray)).toBe("v0.1.0");
  });

  it("is still refused below a stray tag that is a version of the 0.x line", () => {
    expect(tagProblem("v0.2.0", ["v0.1.0", "v0.10.0"])).toBe(
      "release tag v0.2.0 is not greater than v0.10.0, the greatest other v* tag",
    );
  });

  it("follows the greatest other v* tag, the previous release", () => {
    expect(latestTag([])).toBeUndefined();
    expect(latestTag(["v0.9.3", "v0.10.0-rc.1", "v0.10.0", "v0.2.0"])).toBe("v0.10.0");
  });

  it("follows the greatest version tag below it, whatever was tagged after it", () => {
    const tags = ["v0.1.0", "v0.2.0-rc.1", "v0.2.0", "v0.3.0", "vnext"];
    expect(previousTag("v0.2.0", tags)).toBe("v0.2.0-rc.1");
    expect(previousTag("v0.3.0", tags)).toBe("v0.2.0");
    expect(previousTag("v0.1.0", tags)).toBeUndefined();
  });

  it("goes to the dist-tag next for a pre-release, and to latest otherwise", () => {
    expect(distTag("v0.2.0")).toBe("latest");
    expect(distTag("v0.2.0-rc.1")).toBe("next");
  });
});

describe("a breaking change since the last tag", () => {
  const breaking = ["feat(contracts)!: a trial names its arm", "fix: one"];

  it("is a ! before the colon of a title, or a BREAKING CHANGE footer", () => {
    expect(isBreaking("feat(contracts)!: x")).toBe(true);
    expect(isBreaking("feat!: x")).toBe(true);
    expect(isBreaking("feat: x\n\nBREAKING CHANGE: the field is gone")).toBe(true);
    expect(isBreaking("fix: x\n\nBREAKING-CHANGE: y")).toBe(true);
    expect(isBreaking("feat: x!\n\nnot a BREAKING CHANGE: mid-line")).toBe(false);
    expect(isBreaking("feat(core): a ! in the text: fine")).toBe(false);
  });

  it("needs a minor bump over the last release in 0.x", () => {
    expect(breakingProblem("v0.3.0", ["v0.2.4"], breaking)).toBeUndefined();
    expect(breakingProblem("v0.2.5", ["v0.2.4"], breaking)).toBe(
      "feat(contracts)!: a trial names its arm is a breaking change since v0.2.4, " +
        "so v0.2.5 must raise the minor version, to v0.3.0 or later",
    );
    expect(breakingProblem("v0.2.5", ["v0.2.4"], ["fix: one"])).toBeUndefined();
  });

  it("counts from the last release, so the pre-releases of a new minor may break", () => {
    expect(breakingProblem("v0.3.0-rc.2", ["v0.2.4", "v0.3.0-rc.1"], breaking)).toBeUndefined();
    expect(breakingProblem("v0.3.0", ["v0.2.4", "v0.3.0-rc.1"], breaking)).toBeUndefined();
    expect(breakingProblem("v0.2.5-rc.1", ["v0.2.4"], breaking)).toMatch(/must raise the minor/);
  });

  it("ignores a stray release outside the 0.x line", () => {
    expect(breakingProblem("v0.2.5", ["v0.2.4", "v1.0.0"], breaking)).toMatch(/since v0\.2\.4/);
  });

  it("needs nothing before the first release", () => {
    expect(breakingProblem("v0.1.0", [], breaking)).toBeUndefined();
    expect(breakingProblem("v0.1.0-rc.2", ["v0.1.0-rc.1"], breaking)).toBeUndefined();
  });
});

describe("the v* tags and the commits of a repository", () => {
  const repo = mkdtempSync(join(tmpdir(), "ichnaea-release-tag-"));
  afterAll(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args: string[]): string =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.org",
        "-c",
        "tag.gpgsign=false",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: repo, encoding: "utf8" },
    );

  it("reads the v* tags with git tag, and leaves other tags out", () => {
    git("init", "--quiet", "--initial-branch=main");
    git("commit", "--quiet", "--allow-empty", "-m", "feat: first");
    for (const tag of ["v0.1.0", "v0.10.0", "build-1"]) git("tag", tag);
    git("tag", "-a", "v0.2.0", "-m", "annotated");
    expect(releaseTags(repo).toSorted()).toEqual(["v0.1.0", "v0.10.0", "v0.2.0"]);
  });

  it("reads every commit message after a tag, with its body", () => {
    git("commit", "--quiet", "--allow-empty", "-m", "fix: second", "-m", "BREAKING CHANGE: y");
    git("commit", "--quiet", "--allow-empty", "-m", "feat: third");
    expect(commitMessages("v0.10.0", "HEAD", repo)).toEqual([
      "feat: third",
      "fix: second\n\nBREAKING CHANGE: y",
    ]);
    expect(commitMessages(undefined, "HEAD", repo)).toHaveLength(3);
  });
});
