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
  it("allows the head of main and an older commit of main", () => {
    expect(notOnMain("refs/heads/main", head, repo)).toBeUndefined();
    expect(notOnMain("refs/heads/main", first, repo)).toBeUndefined();
  });

  it("refuses a commit that is not on main", () => {
    expect(notOnMain("refs/heads/main", offMain, repo)).toBe(
      `commit ${offMain} is not reachable from origin/main`,
    );
  });

  it("refuses a commit that does not exist", () => {
    expect(notOnMain("refs/heads/main", "0".repeat(40), repo)).toMatch(/not reachable/);
  });

  it("refuses a run on another ref, even for a commit of main", () => {
    expect(notOnMain("refs/heads/feature", head, repo)).toBe(
      "the release must run on refs/heads/main, not refs/heads/feature",
    );
    expect(notOnMain("refs/tags/v0.1.0", head, repo)).toMatch(/must run on refs\/heads\/main/);
  });
});
