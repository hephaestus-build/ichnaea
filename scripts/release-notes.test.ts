import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { changes, commitTitles, releaseNotes, tarballName, VERIFY } from "./release-notes.ts";

const titles = [
  "fix(report): a measure without a bound shows 'no bound' (#40)",
  "ci(repo): studies cap their runners (#41)",
  "feat(decide): binary regression at one trial per case (#43)",
  "docs: the documentation site builds with Starlight (#42)",
  "feat(stats)!: a within-case permutation test (#27)",
];

describe("release notes", () => {
  const notes = releaseNotes("v0.2.0", { zod: "4.6.7", previous: "v0.1.0", titles });

  it("install the version from npm, with the tested zod", () => {
    expect(notes).toMatch(
      /^Release v0\.2\.0 of `@tumaet\/ichnaea` on npm, with the dist-tag latest/,
    );
    expect(notes).toContain("pnpm add @tumaet/ichnaea@0.2.0 zod@4.6.7\n");
  });

  it("install a pre-release by its exact version, because it has the dist-tag next", () => {
    const pre = releaseNotes("v0.3.0-rc.1", { zod: "4.6.7", previous: "v0.2.0", titles });
    expect(pre).toContain("with the dist-tag next");
    expect(pre).toContain("pnpm add @tumaet/ichnaea@0.3.0-rc.1 zod@4.6.7\n");
  });

  it("verify the registry signatures and provenance, and the files of the release", () => {
    expect(notes).toContain(VERIFY);
    expect(VERIFY).toContain("npm audit signatures");
    expect(VERIFY).toContain("sha256sum --check --ignore-missing SHA256SUMS");
    expect(notes).toContain("hephaestus-build/ichnaea/.github/workflows/release.yml");
  });

  it("name the tarball as pnpm packs it", () => {
    expect(tarballName("0.2.0")).toBe("tumaet-ichnaea-0.2.0.tgz");
  });

  it("list the conventional commits since the previous release, features and fixes first", () => {
    expect(notes).toContain("## Changes since v0.1.0\n");
    expect(changes(titles)).toBe(
      [
        "### Features",
        "",
        "- feat(decide): binary regression at one trial per case (#43)",
        "- feat(stats)!: a within-case permutation test (#27)",
        "",
        "### Fixes",
        "",
        "- fix(report): a measure without a bound shows 'no bound' (#40)",
        "",
        "### Other changes",
        "",
        "- ci(repo): studies cap their runners (#41)",
        "- docs: the documentation site builds with Starlight (#42)",
      ].join("\n"),
    );
  });

  it("leave out an empty group, and say so when nothing changed", () => {
    expect(changes(["fix: one (#1)"])).toBe("### Fixes\n\n- fix: one (#1)");
    expect(changes([])).toBe("No commits since the previous release.");
  });

  it("list every change on main for the first release", () => {
    const first = releaseNotes("v0.1.0", { zod: "4.6.7", previous: undefined, titles });
    expect(first).toContain("## Changes\n\nThe first release. Every change on main up to it:\n");
    expect(first).not.toContain("since");
  });
});

describe("the commit titles of a release", () => {
  const repo = mkdtempSync(join(tmpdir(), "ichnaea-notes-"));
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
        "commit.gpgsign=false",
        "-c",
        "tag.gpgsign=false",
        ...args,
      ],
      { cwd: repo, encoding: "utf8" },
    );

  it("are the titles after the previous tag up to the head, newest first", () => {
    git("init", "--quiet", "--initial-branch=main");
    git("commit", "--quiet", "--allow-empty", "-m", "feat: first");
    git("tag", "v0.1.0");
    git("commit", "--quiet", "--allow-empty", "-m", "fix: second\n\nA body line.");
    git("commit", "--quiet", "--allow-empty", "-m", "feat: third");
    const head = git("rev-parse", "HEAD").trim();
    expect(commitTitles("v0.1.0", head, repo)).toEqual(["feat: third", "fix: second"]);
    expect(commitTitles(undefined, head, repo)).toEqual([
      "feat: third",
      "fix: second",
      "feat: first",
    ]);
  });
});
