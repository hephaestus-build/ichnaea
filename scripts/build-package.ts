// Builds the package and assembles its tree: the shipped package.json, dist/, src/, schemas/,
// README.md, LICENSE, the SBOM (sbom.cdx.json) and build.json. The `build` branch holds this tree,
// and a release packs it. The tree is deterministic: the same source commit, lockfile, Node and
// pnpm give the same bytes and modes, so that anyone can rebuild a build commit and compare
// (scripts/verify-build.ts).
// Usage: node scripts/build-package.ts <empty output directory> [--source-commit <sha>]
//          [--version <version>]
// Without --source-commit, the source commit is HEAD. The tree holds the working tree's files.
// Without --version, the shipped package.json has main's version, 0.0.0. The release workflow
// stamps the tag's version, so that a release needs no commit that changes the version.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

import { buildSbom } from "./release-sbom.ts";
import { RELEASE_VERSION } from "./release-version.ts";

export const REPOSITORY: string = join(import.meta.dirname, "..");
export const PACKAGE: string = join(REPOSITORY, "packages", "ichnaea");

/** The file of the tree that describes the build. It is not part of its own digest. */
export const BUILD_INFO = "build.json";
export const SBOM = "sbom.cdx.json";

/** The fields of the development manifest that the shipped manifest keeps, as they are. */
const KEPT = [
  "name",
  "version",
  "description",
  "keywords",
  "homepage",
  "license",
  "repository",
  "bin",
  "type",
  "sideEffects",
  "exports",
  "peerDependencies",
  "engines",
  "publishConfig",
] as const;

/** The condition that resolves the package to its sources inside this repository only. */
const SOURCE_CONDITION = "ichnaea-source";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * The shipped manifest: the kept fields of the development manifest, without the source condition.
 * It has no scripts, so installing it runs nothing; no devDependencies; and no dependency at all,
 * so no `workspace:` range. Its top-level keys are sorted. The conditions of an export keep their
 * order, because Node and TypeScript take the first condition that matches. It is not `private`,
 * which keeps the development manifest off npm. A `version` replaces the development manifest's.
 */
export function shippedManifest(
  development: Readonly<Record<string, Json>>,
  version?: string,
): Record<string, Json> {
  if (version !== undefined && !RELEASE_VERSION.test(version))
    throw new Error(`${version} is not a release version, <major>.<minor>.<patch>[-<pre-release>]`);
  const manifest: Record<string, Json> = {};
  for (const key of KEPT.toSorted()) {
    const value = key === "version" && version !== undefined ? version : development[key];
    if (value !== undefined) manifest[key] = structuredClone(value);
  }
  const exports = manifest["exports"];
  if (typeof exports === "object" && exports !== null && !Array.isArray(exports))
    for (const target of Object.values(exports))
      if (typeof target === "object" && target !== null && !Array.isArray(target))
        delete target[SOURCE_CONDITION];
  return manifest;
}

/** The text of a JSON file in the tree: two-space indentation and a final newline. */
export const jsonText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** Returns one problem per way in which a shipped manifest could run code or pull in the repo. */
export function manifestProblems(manifest: Readonly<Record<string, unknown>>): string[] {
  const problems: string[] = [];
  for (const key of ["scripts", "devDependencies", "dependencies", "optionalDependencies"])
    if (key in manifest) problems.push(`the manifest has ${key}`);
  if ("private" in manifest) problems.push("the manifest is private");
  const text = JSON.stringify(manifest);
  if (text.includes("workspace:")) problems.push("the manifest has a workspace: range");
  if (text.includes(SOURCE_CONDITION))
    problems.push(`the manifest has the ${SOURCE_CONDITION} condition`);
  return problems;
}

/** Every file that the manifest's `exports` and `bin` name, with `*` patterns expanded to a sample. */
export function manifestTargets(manifest: Readonly<Record<string, unknown>>): string[] {
  const targets: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value === "string") targets.push(value);
    else if (typeof value === "object" && value !== null) Object.values(value).forEach(add);
  };
  add(manifest["exports"]);
  add(manifest["bin"]);
  return targets;
}

/** Returns one problem per `exports` or `bin` target that the tree does not hold. */
export function missingTargets(
  tree: string,
  manifest: Readonly<Record<string, unknown>>,
): string[] {
  return manifestTargets(manifest).flatMap((target) => {
    const path = target.replace(/^\.\//, "");
    if (!path.includes("*")) return existsSync(join(tree, path)) ? [] : [`${target} is missing`];
    // A pattern needs at least one file that it matches.
    const [prefix = "", suffix = ""] = path.split("*");
    const folder = prefix.slice(0, prefix.lastIndexOf("/") + 1);
    const dir = join(tree, folder);
    const found =
      existsSync(dir) &&
      readdirSync(dir).some((f) => `${folder}${f}`.startsWith(prefix) && f.endsWith(suffix));
    return found ? [] : [`${target} matches no file`];
  });
}

export interface TreeFile {
  /** The path in the tree, with `/` separators. */
  readonly path: string;
  /** The git mode: 100755 for an executable file, 100644 for any other. */
  readonly mode: "100644" | "100755";
  readonly bytes: Buffer;
}

/** Every file of a directory, sorted by path, with its git mode and content. */
export function treeFiles(dir: string): TreeFile[] {
  const files: TreeFile[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile())
        files.push({
          path: relative(dir, path).split(sep).join("/"),
          mode: statSync(path).mode & 0o111 ? "100755" : "100644",
          bytes: readFileSync(path),
        });
      else throw new Error(`${path} is neither a file nor a directory`);
    }
  };
  walk(dir);
  return files.toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The SHA-256 of a tree: of each file's path, mode and SHA-256, in path order. */
export function treeDigest(files: readonly TreeFile[]): string {
  const hash = createHash("sha256");
  for (const f of files)
    hash.update(`${f.mode} ${createHash("sha256").update(f.bytes).digest("hex")} ${f.path}\n`);
  return hash.digest("hex");
}

/**
 * Every difference between an expected tree and an actual one, in path order: a path that only one
 * holds, other bytes, or another mode. The first entry names the first differing path.
 */
export function treeDifferences(
  expected: readonly TreeFile[],
  actual: readonly TreeFile[],
): string[] {
  const want = new Map(expected.map((f) => [f.path, f]));
  const have = new Map(actual.map((f) => [f.path, f]));
  const paths = [...new Set([...want.keys(), ...have.keys()])].toSorted((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return paths.flatMap((path) => {
    const w = want.get(path);
    const h = have.get(path);
    if (!w) return [`${path}: only in the rebuilt tree`];
    if (!h) return [`${path}: missing from the rebuilt tree`];
    if (!w.bytes.equals(h.bytes)) return [`${path}: the bytes differ`];
    if (w.mode !== h.mode) return [`${path}: mode ${h.mode}, expected ${w.mode}`];
    return [];
  });
}

/** The tracked and untracked, not ignored files under a directory of the repository. */
function workingTreeFiles(dir: string): string[] {
  return execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      relative(REPOSITORY, dir),
    ],
    { cwd: REPOSITORY, encoding: "utf8" },
  )
    .split("\0")
    .filter((f) => f !== "" && existsSync(join(REPOSITORY, f)));
}

/** Copies a file into the tree with a fixed mode, so the tree does not depend on the umask. */
function place(from: string, tree: string, path: string, mode = 0o644): void {
  const to = join(tree, path);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  chmodSync(to, mode);
}

/** The source commit's committer date, in ISO 8601 UTC with a Z: the SBOM's timestamp. */
export function commitDate(commit: string, cwd = REPOSITORY): string {
  const date = execFileSync("git", ["show", "-s", "--format=%cI", commit], {
    cwd,
    encoding: "utf8",
  });
  return new Date(date.trim()).toISOString().replace(/\.000Z$/, "Z");
}

export interface BuildInfo {
  readonly node: string;
  readonly pnpm: string;
  readonly sourceCommit: string;
  /** {@link treeDigest} of every file of the tree but build.json. */
  readonly treeDigest: string;
}

/**
 * Builds the package and assembles its tree in `tree`, which must not exist or be empty. A
 * `version` is stamped into the shipped manifest.
 */
export function assemble(tree: string, sourceCommit: string, version?: string): BuildInfo {
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error(`${sourceCommit} is not a commit SHA`);
  if (existsSync(tree) && readdirSync(tree).length > 0) throw new Error(`${tree} is not empty`);
  mkdirSync(tree, { recursive: true });

  // A clean build: dist/ holds only what this build writes.
  rmSync(join(PACKAGE, "dist"), { recursive: true, force: true });
  execFileSync(join(REPOSITORY, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.build.json"], {
    cwd: PACKAGE,
    stdio: "inherit",
  });

  const development = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as Record<
    string,
    Json
  >;
  const manifest = shippedManifest(development, version);
  const problems = manifestProblems(manifest);
  if (problems.length > 0) throw new Error(`the shipped manifest is wrong: ${problems.join("; ")}`);
  writeFileSync(join(tree, "package.json"), jsonText(manifest));
  chmodSync(join(tree, "package.json"), 0o644);

  for (const file of treeFiles(join(PACKAGE, "dist")))
    place(join(PACKAGE, "dist", file.path), tree, `dist/${file.path}`);
  for (const file of workingTreeFiles(join(PACKAGE, "src")).concat(
    workingTreeFiles(join(PACKAGE, "schemas")),
  ))
    place(join(REPOSITORY, file), tree, relative(PACKAGE, join(REPOSITORY, file)));
  place(join(PACKAGE, "README.md"), tree, "README.md");
  place(join(REPOSITORY, "LICENSE"), tree, "LICENSE");
  // The bin keeps its executable bit, as git records it on the build branch.
  for (const target of Object.values((manifest["bin"] ?? {}) as Record<string, string>))
    chmodSync(join(tree, target), 0o755);

  const missing = missingTargets(tree, manifest);
  if (missing.length > 0)
    throw new Error(`the tree misses manifest targets: ${missing.join("; ")}`);

  writeFileSync(
    join(tree, SBOM),
    jsonText(buildSbom(tree, sourceCommit, commitDate(sourceCommit))),
  );
  chmodSync(join(tree, SBOM), 0o644);

  const info: BuildInfo = {
    node: process.version,
    pnpm: execFileSync("pnpm", ["--version"], { cwd: REPOSITORY, encoding: "utf8" }).trim(),
    sourceCommit,
    treeDigest: treeDigest(treeFiles(tree)),
  };
  writeFileSync(join(tree, BUILD_INFO), jsonText(info));
  chmodSync(join(tree, BUILD_INFO), 0o644);
  return info;
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { "source-commit": { type: "string" }, version: { type: "string" } },
  });
  const [out] = positionals;
  if (!out || positionals.length !== 1)
    throw new Error(
      "usage: build-package.ts <output directory> [--source-commit <sha>] [--version <version>]",
    );
  const commit =
    values["source-commit"] ??
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPOSITORY, encoding: "utf8" }).trim();
  const info = assemble(resolve(out), commit, values.version);
  const { version } = JSON.parse(readFileSync(join(out, "package.json"), "utf8")) as {
    version: string;
  };
  console.log(`build: ${out} at ${version} from ${info.sourceCommit}, tree ${info.treeDigest}`);
}
