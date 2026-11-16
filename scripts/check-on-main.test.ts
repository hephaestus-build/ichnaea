import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { notOnMain } from "./check-on-main.ts";

// A repository whose origin/main has two commits, and a branch with one commit off main.
const repo = mkdtempSync(join(tmpdir(), "ichnaea-on-main-"));
const git = (...args: string[]): string =>
  execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.org", "-c", "commit.gpgsign=false", ...args],
    { cwd: repo, encoding: "utf8" },
  ).trim();
git("init", "--quiet", "--initial-branch=main");
git("commit", "--quiet", "--allow-empty", "-m", "first");
const first = git("rev-parse", "HEAD");
git("switch", "--quiet", "-c", "feature");
git("commit", "--quiet", "--allow-empty", "-m", "unreviewed");
const offMain = git("rev-parse", "HEAD");
git("switch", "--quiet", "main");
git("commit", "--quiet", "--allow-empty", "-m", "second");
const head = git("rev-parse", "HEAD");
git("update-ref", "refs/remotes/origin/main", head);
afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("release commit on main", () => {
  it("allows a release tag on the head of main and on an older commit of main", () => {
    expect(notOnMain("refs/tags/v0.2.0", head, repo)).toBeUndefined();
    expect(notOnMain("refs/tags/v0.1.0-rc.1", first, repo)).toBeUndefined();
  });

  it("refuses a tagged commit that is not on main", () => {
    expect(notOnMain("refs/tags/v0.2.0", offMain, repo)).toBe(
      `commit ${offMain} is not reachable from origin/main`,
    );
  });

  it("refuses a commit that does not exist", () => {
    expect(notOnMain("refs/tags/v0.2.0", "0".repeat(40), repo)).toMatch(/not reachable/);
  });

  it("refuses a run that a branch or another tag started, even for a commit of main", () => {
    for (const ref of ["refs/heads/main", "refs/heads/feature", "refs/tags/build-1"])
      expect(notOnMain(ref, head, repo), ref).toBe(
        `the release must run on a pushed v* tag, not ${ref}`,
      );
  });
});
