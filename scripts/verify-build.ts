// Rebuilds a commit of the `build` branch from its source commit and refuses any difference. The
// integrity of a build commit comes from this: a reviewed, signed commit on main, a deterministic
// build that anyone can reproduce, and the build commit (decision 0019).
//
// It reads the build commit's `Source-Commit:` trailer and checks that the commit is on main
// (origin/main) and that GitHub verified its signature. The GitHub API answers without a token for
// this public repository; GH_TOKEN or GITHUB_TOKEN, when set, raises its rate limit. It checks out the source commit into a temporary worktree, installs with the
// frozen lockfile, and assembles the tree with that commit's own scripts/build-package.ts and this
// Node. Then it compares the rebuilt tree with the build commit's tree: the same paths, the same
// bytes and the same modes. On a difference it refuses and names the first differing path in path
// order, then lists the rest. It refuses as well when the Node or pnpm version is not the one that
// the build commit's build.json records, and when the build commit's SBOM is missing or does not
// describe the build.
// Usage: node scripts/verify-build.ts <build commit>
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BUILD_INFO,
  commitDate,
  REPOSITORY,
  SBOM,
  treeDifferences,
  treeFiles,
  type BuildInfo,
  type TreeFile,
} from "./build-package.ts";
import { checkBuildSbom } from "./check-sbom.ts";

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "advice.detachedHead=false", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });

/** The `Source-Commit:` trailer of a commit message: exactly one full SHA. */
export function sourceCommitOf(message: string): string {
  const values = [...message.matchAll(/^Source-Commit: *(\S+) *$/gm)].map((m) => m[1]!);
  if (values.length !== 1)
    throw new Error(`the build commit has ${values.length} Source-Commit trailers, not one`);
  const [sha = ""] = values;
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`Source-Commit ${sha} is not a full commit SHA`);
  return sha;
}

/** Returns why the build's recorded tools are not the ones running, or nothing. */
export function toolProblems(info: Readonly<BuildInfo>, node: string, pnpm: string): string[] {
  const problems: string[] = [];
  if (info.node !== node)
    problems.push(`the build used Node ${info.node}; run the verification with it, not ${node}`);
  if (info.pnpm !== pnpm)
    problems.push(`the build used pnpm ${info.pnpm}; run the verification with it, not ${pnpm}`);
  return problems;
}

/** The files of a commit's tree, with their git modes and contents, sorted by path. */
export function commitFiles(commit: string, cwd = REPOSITORY): TreeFile[] {
  return git(cwd, "ls-tree", "-r", "-z", "--full-tree", commit)
    .split("\0")
    .filter((line) => line !== "")
    .map((line) => {
      const [meta = "", path = ""] = line.split("\t");
      const [mode = "", type = "", object = ""] = meta.split(" ");
      if (type !== "blob" || (mode !== "100644" && mode !== "100755"))
        throw new Error(`${path} in ${commit} is a ${type} with mode ${mode}, not a regular file`);
      const bytes = execFileSync("git", ["cat-file", "blob", object], { cwd, maxBuffer: 1 << 28 });
      return { path, mode, bytes } satisfies TreeFile;
    })
    .toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The repository whose commits the build branch holds. */
export const GITHUB_REPOSITORY = "hephaestus-build/ichnaea";

/** Returns why GitHub does not show a commit's signature as verified, or nothing. */
export async function signatureProblem(commit: string): Promise<string | undefined> {
  const token = process.env["GH_TOKEN"] ?? process.env["GITHUB_TOKEN"];
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPOSITORY}/commits/${commit}`,
    {
      headers: {
        accept: "application/vnd.github+json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    },
  );
  if (!response.ok) return `GitHub did not return ${commit}: HTTP ${response.status}`;
  const body = (await response.json()) as {
    commit?: { verification?: { verified?: unknown; reason?: unknown } };
  };
  const verification = body.commit?.verification;
  return verification?.verified === true
    ? undefined
    : `Source-Commit ${commit} is not a signed commit: GitHub gives ${String(verification?.reason ?? "no verification")}`;
}

/** Fetches a commit from origin unless the repository has it already. */
function ensureCommit(commit: string): void {
  try {
    git(REPOSITORY, "cat-file", "-e", `${commit}^{commit}`);
  } catch {
    git(REPOSITORY, "fetch", "--quiet", "origin", commit);
  }
}

/** Rebuilds a build commit and returns every problem, the first differing path first. */
export async function verifyBuild(build: string): Promise<string[]> {
  ensureCommit(build);
  const commit = git(REPOSITORY, "rev-parse", "--verify", `${build}^{commit}`).trim();
  const source = sourceCommitOf(git(REPOSITORY, "log", "-1", "--format=%B", commit));
  ensureCommit(source);
  git(REPOSITORY, "fetch", "--quiet", "origin", "+refs/heads/main:refs/remotes/origin/main");
  try {
    git(REPOSITORY, "merge-base", "--is-ancestor", source, "refs/remotes/origin/main");
  } catch {
    return [`Source-Commit ${source} is not on origin/main`];
  }
  const unsigned = await signatureProblem(source);
  if (unsigned) return [unsigned];

  const expected = commitFiles(commit);
  const info = expected.find((f) => f.path === BUILD_INFO);
  const sbom = expected.find((f) => f.path === SBOM);
  if (!info) return [`the build commit has no ${BUILD_INFO}`];
  if (!sbom) return [`the build commit has no ${SBOM}`];
  const recorded = JSON.parse(info.bytes.toString("utf8")) as BuildInfo;
  if (recorded.sourceCommit !== source)
    return [`${BUILD_INFO} names ${recorded.sourceCommit}, the trailer ${source}`];
  const tools = toolProblems(
    recorded,
    process.version,
    execFileSync("pnpm", ["--version"], { cwd: REPOSITORY, encoding: "utf8" }).trim(),
  );
  if (tools.length > 0) return tools;
  const manifest = expected.find((f) => f.path === "package.json");
  const pkg = JSON.parse(manifest?.bytes.toString("utf8") ?? "{}") as {
    name: string;
    version: string;
    peerDependencies?: Record<string, string>;
  };
  const sbomProblems = checkBuildSbom(
    JSON.parse(sbom.bytes.toString("utf8")),
    pkg,
    source,
    commitDate(source),
  );

  const work = mkdtempSync(join(tmpdir(), "ichnaea-verify-"));
  const checkout = join(work, "source");
  try {
    git(REPOSITORY, "worktree", "add", "--quiet", "--detach", checkout, source);
    execFileSync("pnpm", ["install", "--frozen-lockfile"], { cwd: checkout, stdio: "inherit" });
    const tree = join(work, "tree");
    execFileSync("node", ["scripts/build-package.ts", tree, "--source-commit", source], {
      cwd: checkout,
      stdio: "inherit",
    });
    return [...treeDifferences(expected, treeFiles(tree)), ...sbomProblems];
  } finally {
    git(REPOSITORY, "worktree", "remove", "--force", checkout);
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [build, ...rest] = process.argv.slice(2);
  if (!build || rest.length > 0) throw new Error("usage: verify-build.ts <build commit>");
  const problems = await verifyBuild(build);
  if (problems.length > 0) {
    console.error(
      `verify-build: ${build} is not the build of its source commit. First difference: ${problems[0]}`,
    );
    if (problems.length > 1) console.error(`All differences:\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log(`verify-build: ${build} is byte for byte the build of its source commit`);
}
