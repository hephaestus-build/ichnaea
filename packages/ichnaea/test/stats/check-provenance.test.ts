// The currency check of a published study output (scripts/stats/check-sweep-provenance.ts): at
// HEAD, every pinned file and package and the Node version are as the run recorded them, and the
// run commit is reachable from the pull request head that the sidecar names. Each case builds a
// scratch repository whose `origin` holds that pull request head, and a squash of it on main, and
// installs a node_modules laid out as pnpm does: two versions of `dep`, and `sub` that `dep` uses.
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checkProvenance, STUDY_WORKFLOWS } from "../../scripts/stats/check-sweep-provenance.ts";
import { metaPath, sha256 } from "../../scripts/stats/provenance.ts";
import { commit, removeScratchRepos, runGit, scratchRepo } from "./support/git-repo.ts";

afterAll(removeScratchRepos);

const workflow = (version: string): string => `env:\n  NODE_VERSION: ${version}\n`;
const FILES = {
  ...Object.fromEntries(STUDY_WORKFLOWS.map((w) => [w, workflow("24.22.2")])),
  ".gitignore": "node_modules\n",
  "src/pinned.ts": "export const pinned = 1;\n",
  "src/unpinned.ts": "export const unpinned = 1;\n",
  "out.tsv": "x\n1\n",
};

let template = "";
let origin = "";
let run = "";
beforeAll(() => {
  // The base, then the pull request's run commit on a branch, then its squash on main.
  template = scratchRepo();
  commit(template, { "README.md": "base\n" }, "base");
  runGit(template, "checkout", "--quiet", "-b", "pr");
  run = commit(template, FILES, "run");
  commit(template, { "later.txt": "after the run\n" }, "later");
  origin = scratchRepo(false);
  runGit(origin, "init", "--quiet", "--bare");
  runGit(template, "remote", "add", "origin", origin);
  runGit(template, "push", "--quiet", "origin", "pr:refs/pull/7/head");
  runGit(template, "checkout", "--quiet", "main");
  commit(template, FILES, "squash");
  runGit(template, "branch", "--quiet", "-D", "pr");
  runGit(template, "push", "--quiet", "origin", "main");
});

const DEP = (version: string): string => `export const dep = "${version}";\n`;
const SUB = "export const sub = 1;\n";

/** Writes the package `name@version` into the pnpm store of `root`, with `files`. */
function storePackage(root: string, key: string, files: Readonly<Record<string, string>>): string {
  const name = key.slice(0, key.lastIndexOf("@"));
  const dir = path.join(root, "node_modules", ".pnpm", key, "node_modules", name);
  mkdirSync(dir, { recursive: true });
  const version = key.slice(key.lastIndexOf("@") + 1);
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version }));
  for (const [file, text] of Object.entries(files)) writeFileSync(path.join(dir, file), text);
  return dir;
}

/** Links node_modules/dep to the installed `dep@version`, as pnpm does for the root importer. */
function linkDep(root: string, version: string): void {
  rmSync(path.join(root, "node_modules", "dep"), { force: true });
  symlinkSync(`.pnpm/dep@${version}/node_modules/dep`, path.join(root, "node_modules", "dep"));
}

/** Installs dep@1.0.0, which uses sub@1.0.0, and dep@2.0.0, which another importer keeps. */
function install(root: string): void {
  storePackage(root, "dep@1.0.0", { "index.js": DEP("1.0.0") });
  storePackage(root, "dep@2.0.0", { "index.js": DEP("2.0.0") });
  storePackage(root, "sub@1.0.0", { "index.js": SUB });
  symlinkSync(
    "../../sub@1.0.0/node_modules/sub",
    path.join(root, "node_modules", ".pnpm", "dep@1.0.0", "node_modules", "sub"),
  );
  linkDep(root, "1.0.0");
}

/**
 * A copy of the template and of its origin, with the output's sidecar as the run wrote it, with
 * `meta` over it. A shallow repository is a clone of main at depth 1, as CI checks out.
 */
function repo(
  meta: Record<string, unknown> = {},
  shallow = false,
): { root: string; output: string } {
  const remote = scratchRepo(false);
  cpSync(origin, remote, { recursive: true });
  const root = scratchRepo(false);
  if (shallow)
    runGit(root, "clone", "--quiet", "--depth=1", "--branch=main", pathToFileURL(remote).href, ".");
  else {
    cpSync(template, root, { recursive: true });
    runGit(root, "remote", "set-url", "origin", remote);
  }
  install(root);
  const output = path.join(root, "out.tsv");
  const sidecar = {
    schema: "ichnaea.stats-provenance/2",
    script: "src/pinned.ts",
    commit: run,
    pull: 7,
    files: { "src/pinned.ts": sha256(FILES["src/pinned.ts"]) },
    packages: {
      "dep@1.0.0": { importedBy: ["src/pinned.ts"], files: { "index.js": sha256(DEP("1.0.0")) } },
      "sub@1.0.0": { importedBy: ["dep@1.0.0"], files: { "index.js": sha256(SUB) } },
    },
    seedBase: 1,
    arguments: [],
    node: "v24.22.2",
    started: "2026-11-17T00:00:00.000Z",
    output: "out.tsv",
    complete: true,
    outputSha256: sha256(readFileSync(output)),
    ...meta,
  };
  writeFileSync(metaPath(output), JSON.stringify(sidecar));
  return { root, output };
}

describe("the currency check", () => {
  it("passes on a squash of the run: the run commit need not be an ancestor of HEAD", () => {
    const { root, output } = repo();
    expect(() => runGit(root, "merge-base", "--is-ancestor", run, "HEAD")).toThrow();
    expect(checkProvenance([output], root)).toEqual([]);
  });

  it("passes in a shallow clone: it fetches the pull request head and its history", () => {
    const { root, output } = repo({}, true);
    expect(runGit(root, "rev-parse", "--is-shallow-repository")).toBe("true");
    expect(() => runGit(root, "cat-file", "-e", `${run}^{commit}`)).toThrow();
    expect(checkProvenance([output], root)).toEqual([]);
  });

  it("passes when a file the run did not load changes", () => {
    const { root, output } = repo();
    commit(root, { "src/unpinned.ts": "export const unpinned = 2;\n" });
    expect(checkProvenance([output], root)).toEqual([]);
  });

  it("fails when a pinned file changes, and says to rerun", () => {
    const { root, output } = repo();
    commit(root, { "src/pinned.ts": "export const pinned = 2;\n" });
    const [failure] = checkProvenance([output], root);
    expect(failure).toMatch(/src\/pinned\.ts at HEAD has sha256 [0-9a-f]{64}/);
    expect(failure).toMatch(/rerun the study at the new commit; never edit the sidecar/);
  });

  it("fails when the importer resolves a pinned package to another version", () => {
    const { root, output } = repo();
    // The study's importer moved to dep@2.0.0; another importer keeps dep@1.0.0 installed.
    linkDep(root, "2.0.0");
    expect(checkProvenance([output], root)).toEqual([
      expect.stringMatching(
        /dep resolves to dep@2\.0\.0 from src\/pinned\.ts at HEAD, the run loaded dep@1\.0\.0.*rerun the study/,
      ),
    ]);
  });

  it("fails when a loaded file of a pinned package has other bytes, as after a patch", () => {
    const { root, output } = repo();
    writeFileSync(
      path.join(root, "node_modules", ".pnpm", "sub@1.0.0", "node_modules", "sub", "index.js"),
      "export const sub = 2;\n",
    );
    expect(checkProvenance([output], root)).toEqual([
      expect.stringMatching(/sub@1\.0\.0\/index\.js has sha256 [0-9a-f]{64}.*rerun the study/),
    ]);
  });

  it("fails when a pinned package is not installed", () => {
    const { root, output } = repo();
    rmSync(path.join(root, "node_modules", "dep"));
    expect(checkProvenance([output], root)).toEqual([
      expect.stringMatching(/cannot resolve dep from src\/pinned\.ts at HEAD/),
    ]);
  });

  it("fails when the study workflows pin another Node version", () => {
    const { root, output } = repo();
    commit(root, Object.fromEntries(STUDY_WORKFLOWS.map((w) => [w, workflow("24.23.0")])));
    expect(checkProvenance([output], root)).toEqual([
      expect.stringMatching(/ran on Node v24\.22\.2, the study workflows pin v24\.23\.0/),
    ]);
  });

  it("fails when the study workflows disagree on the Node version", () => {
    const { root, output } = repo();
    commit(root, { [STUDY_WORKFLOWS[0]!]: workflow("24.23.0") });
    expect(checkProvenance([output], root)).toEqual([
      expect.stringMatching(/the study workflows pin different Node versions/),
    ]);
  });

  it("refuses a sidecar of the first schema", () => {
    const { root, output } = repo({ schema: "ichnaea.stats-provenance/1" });
    expect(checkProvenance([output], root)).toEqual([
      expect.stringMatching(/ichnaea\.stats-provenance\/1.*rerun the study/),
    ]);
  });

  it("refuses a sidecar without the pull request number", () => {
    const { root, output } = repo({ pull: null });
    expect(checkProvenance([output], root)).toEqual([
      expect.stringMatching(/record the PR number: rerun with --pull/),
    ]);
  });

  it("fails when the pull request head no longer holds the run commit", () => {
    const { root, output } = repo();
    // A force-push after the run: the new head does not descend from the run commit.
    runGit(root, "push", "--quiet", "--force", "origin", "main:refs/pull/7/head");
    const [failure] = checkProvenance([output], root);
    expect(failure).toMatch(/not reachable from refs\/pull\/7\/head/);
    expect(failure).toMatch(/rebased.*rerun the study/);
  });

  it("fails when the pull request head cannot be fetched", () => {
    const { root, output } = repo({ pull: 8 });
    expect(checkProvenance([output], root)).toEqual([
      expect.stringMatching(/cannot fetch refs\/pull\/8\/head/),
    ]);
  });

  it("fails a sidecar re-pinned by hand: the run commit has other bytes", () => {
    const { root, output } = repo();
    const moved = "export const pinned = 2;\n";
    commit(root, { "src/pinned.ts": moved });
    writeFileSync(
      metaPath(output),
      JSON.stringify({
        ...JSON.parse(readFileSync(metaPath(output), "utf8")),
        files: { "src/pinned.ts": sha256(moved) },
      }),
    );
    expect(checkProvenance([output], root)).toEqual([
      expect.stringMatching(/src\/pinned\.ts at commit [0-9a-f]{10} has sha256/),
    ]);
  });

  it("fails an output changed after its run, and one without a sidecar", () => {
    const { root, output } = repo();
    writeFileSync(output, "x\n2\n");
    const bare = path.join(root, "bare.tsv");
    writeFileSync(bare, "");
    expect(checkProvenance([output, bare], root)).toEqual([
      expect.stringMatching(/output's sha256 differs/),
      expect.stringMatching(/no sidecar/),
    ]);
  });

  it("refuses a published output that is not complete", () => {
    const { root, output } = repo({ complete: false });
    writeFileSync(output, "x\n2\n");
    expect(checkProvenance([output], root)).toEqual([
      expect.stringMatching(/a published output must be complete; rerun the study/),
    ]);
    const { root: other, output: bare } = repo({ outputSha256: undefined });
    expect(checkProvenance([bare], other)).toEqual([
      expect.stringMatching(/a published output must be complete; rerun the study/),
    ]);
  });

  it("checks an output of an unpublished run without a pull request", () => {
    const { root, output } = repo({ pull: null });
    expect(checkProvenance([output], root, { published: false })).toEqual([]);
  });

  it("fails an output of an unpublished run whose commit is unknown", () => {
    const { root, output } = repo({ commit: "0123456789abcdef0123456789abcdef01234567" });
    expect(checkProvenance([output], root, { published: false })).toEqual([
      expect.stringMatching(/commit 0123456789.* is unknown/),
    ]);
  });
});
