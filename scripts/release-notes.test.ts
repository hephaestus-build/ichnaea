import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  changes,
  commitTitles,
  downloadUrl,
  releaseNotes,
  tarballName,
  verify,
} from "./release-notes.ts";

const titles = [
  "fix(report): a measure without a bound shows 'no bound' (#40)",
  "ci(repo): studies cap their runners (#41)",
  "feat(decide): binary regression at one trial per case (#43)",
  "docs: the documentation site builds with Starlight (#42)",
  "feat(stats): a within-case permutation test (#27)",
];

describe("release notes", () => {
  const notes = releaseNotes("v0.2.0", { zod: "4.6.7", previous: "v0.1.0", titles });

  it("install the tarball from its URL on the release, with the tested zod", () => {
    expect(tarballName("0.2.0")).toBe("hephaestus-build-ichnaea-0.2.0.tgz");
    expect(notes).toContain(
      'pnpm add zod@4.6.7 "https://github.com/hephaestus-build/ichnaea/releases/download/v0.2.0/hephaestus-build-ichnaea-0.2.0.tgz"',
    );
    expect(downloadUrl("v0.2.0", "SHA256SUMS")).toBe(
      "https://github.com/hephaestus-build/ichnaea/releases/download/v0.2.0/SHA256SUMS",
    );
  });

  it("verify the tarball by the release workflow on main, not only by the repository", () => {
    const commands = verify("hephaestus-build-ichnaea-0.2.0.tgz");
    expect(notes).toContain(commands);
    expect(commands).toContain(
      "gh attestation verify hephaestus-build-ichnaea-0.2.0.tgz --repo hephaestus-build/ichnaea",
    );
    expect(
      commands.match(
        /--signer-workflow hephaestus-build\/ichnaea\/\.github\/workflows\/release\.yml/g,
      ),
    ).toHaveLength(2);
    expect(commands.match(/--source-ref refs\/heads\/main/g)).toHaveLength(2);
    expect(commands).toContain("--predicate-type https://cyclonedx.org/bom");
    expect(commands).toContain("sha256sum --check --ignore-missing SHA256SUMS");
  });

  it("list the conventional commits since the previous release, features and fixes first", () => {
    expect(notes).toContain("## Changes since v0.1.0\n");
    expect(changes(titles)).toBe(
      [
        "### Features",
        "",
        "- feat(decide): binary regression at one trial per case (#43)",
        "- feat(stats): a within-case permutation test (#27)",
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

  it("say that the release is not on npm and that the release is immutable", () => {
    expect(notes).toMatch(/^Release v0\.2\.0 of `@hephaestus-build\/ichnaea`\. It is not on npm\./);
    expect(notes).toContain("immutable");
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
