// Provenance of a study's output file, in a sidecar `<output>.meta.json`: the commit it ran from,
// the pull request whose head holds that commit, the sha256 of every local module its process
// loaded, the name and version of every third-party package it loaded, the Node version, its seed
// base and its arguments. The sidecar keeps the output itself unchanged, so a rerun can be compared
// with an earlier output byte for byte.
//
// The modules are the ones the process loads, recorded by the hook of record-loads.ts, which the
// study preloads with `node --import`. A module that is not loaded cannot change the output, so a
// change to it needs no rerun. No module the study loads may only re-export: a barrel would pin
// every file it re-exports, so a module imports the file that defines what it uses (a lint rule
// holds that too).
//
// A study refuses to run when a tracked file has uncommitted changes, or when a module it loads is
// not tracked, so the commit names the code that ran. Untracked files (outputs, node_modules) do
// not count. check-sweep-provenance.ts checks a sidecar against the repository at HEAD.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PROVENANCE_SCHEMA = "ichnaea.stats-provenance/2";

/** What a sidecar records about the run that wrote its output. */
export interface Provenance {
  readonly schema: typeof PROVENANCE_SCHEMA;
  /** The script that ran, relative to the repository root. */
  readonly script: string;
  /** `git rev-parse HEAD` when the run started. */
  readonly commit: string;
  /** The pull request whose head holds `commit` (`--pull`); null for a run not published. */
  readonly pull: number | null;
  /** The sha256 of every local module the run loaded, the script included, by repository path. */
  readonly files: Readonly<Record<string, string>>;
  /** Every third-party package the run loaded, as `name@version`, sorted. */
  readonly packages: readonly string[];
  readonly seedBase: number | null;
  /** The script's command-line arguments, as given. */
  readonly arguments: readonly string[];
  readonly node: string;
  readonly started: string;
}

/** The sidecar of an output file. */
export const metaPath = (output: string): string => `${output}.meta.json`;

export const sha256 = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

/** Runs git in `cwd` and returns its trimmed standard output. */
export function git(args: readonly string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    .toString()
    .trim();
}

/** The root of the repository that holds `file`. */
export const repoRoot = (file: string): string =>
  realpathSync(git(["rev-parse", "--show-toplevel"], path.dirname(realpathSync(file))));

/** The command that records a study's loaded modules, from the package's directory. */
export const RECORD_LOADS = "node --import ./scripts/stats/record-loads.ts";

// The same key as in record-loads.ts, which imports nothing local.
const LOADED_MODULES = Symbol.for("ichnaea.stats.loaded-modules");

/** The URLs of the files this process loaded as modules; undefined when nothing records them. */
function loadedUrls(): ReadonlySet<string> | undefined {
  const value: unknown = Reflect.get(globalThis, LOADED_MODULES);
  return value instanceof Set ? (value as Set<string>) : undefined;
}

/** True when the module's source holds nothing but `export … from` statements. */
export function reexportsOnly(source: string): boolean {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .trim();
  const REEXPORT =
    /^export\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(["'])[^"']*\1\s*;?\s*/;
  let rest = code;
  let statements = 0;
  for (let m = REEXPORT.exec(rest); m !== null; m = REEXPORT.exec(rest)) {
    rest = rest.slice(m[0].length);
    statements += 1;
  }
  return statements > 0 && rest === "";
}

const NODE_MODULES = `${path.sep}node_modules${path.sep}`;

/** The installed package that holds `file` as `name@version`, or undefined outside node_modules. */
export function packageOf(file: string): string | undefined {
  const at = file.lastIndexOf(NODE_MODULES);
  if (at < 0) return undefined;
  const parts = file.slice(at + NODE_MODULES.length).split(path.sep);
  const name = parts[0]?.startsWith("@") ? `${parts[0]}/${parts[1]}` : (parts[0] ?? "");
  const dir = path.join(file.slice(0, at + NODE_MODULES.length), ...name.split("/"));
  const manifest: unknown = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const version: unknown = Reflect.get(Object(manifest), "version");
  if (Reflect.get(Object(manifest), "name") !== name || typeof version !== "string")
    throw new Error(`${dir}/package.json does not name ${name} and a version`);
  return `${name}@${version}`;
}

/** True when the `packages:` section of a pnpm lockfile resolves a package to `name@version`. */
export function lockfileHolds(lockfile: string, pkg: string): boolean {
  const key = new RegExp(`^ {2}'?${pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'?:`);
  let section = "";
  for (const line of lockfile.split("\n")) {
    if (/^\S.*:\s*$/.test(line)) section = line.trim();
    else if (section === "packages:" && key.test(line)) return true;
  }
  return false;
}

/** What the run has loaded so far: the local modules with their sha256, and the packages. */
function loadedSet(root: string, script: string): Pick<Provenance, "files" | "packages"> {
  const urls = loadedUrls();
  if (urls === undefined || !urls.has(pathToFileURL(realpathSync(script)).href))
    throw new Error(
      `the run did not record its loaded modules from its start; run it as ${RECORD_LOADS} <script> …`,
    );
  const files: Record<string, string> = {};
  const packages = new Set<string>();
  for (const url of urls) {
    const file = realpathSync(fileURLToPath(url));
    const pkg = packageOf(file);
    if (pkg !== undefined) {
      packages.add(pkg);
      continue;
    }
    const relative = path.relative(root, file);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error(`${file} is outside the repository and outside node_modules`);
    git(["ls-files", "--error-unmatch", "--", relative], root);
    const source = readFileSync(file);
    if (reexportsOnly(source.toString("utf8")))
      throw new Error(
        `${relative} only re-exports; import the file that defines what the study uses`,
      );
    files[relative] = sha256(source);
  }
  const lockfile = readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8");
  for (const pkg of packages)
    if (!lockfileHolds(lockfile, pkg))
      throw new Error(`${pkg} is installed but not in pnpm-lock.yaml; run pnpm install`);
  return {
    files: Object.fromEntries(Object.entries(files).toSorted(([a], [b]) => a.localeCompare(b))),
    packages: [...packages].toSorted(),
  };
}

/** The loaded modules when each provenance was taken, so that a later load is refused. */
const taken = new WeakMap<Provenance, ReadonlySet<string>>();

/**
 * The provenance of a run of `script`: the commit, every module the process has loaded so far,
 * and every package among them. Call it after the study's imports. Throws when the loaded modules
 * were not recorded from the start, when a tracked file has uncommitted changes, or when a loaded
 * module is not tracked or only re-exports. `pull` is the pull request whose head holds the commit;
 * a published output needs it.
 */
export function provenance(
  script: string,
  seedBase: number | null,
  args: readonly string[],
  options: { readonly pull?: number | undefined } = {},
): Provenance {
  const root = repoRoot(script);
  const dirty = git(["status", "--porcelain", "--untracked-files=no"], root);
  if (dirty !== "")
    throw new Error(`tracked files have uncommitted changes; commit them first:\n${dirty}`);
  const { pull } = options;
  if (pull !== undefined && !(Number.isInteger(pull) && pull > 0))
    throw new RangeError(`--pull must be a pull request number, got ${pull}`);
  const p: Provenance = {
    schema: PROVENANCE_SCHEMA,
    script: path.relative(root, realpathSync(script)),
    commit: git(["rev-parse", "HEAD"], root),
    pull: pull ?? null,
    ...loadedSet(root, script),
    seedBase,
    arguments: [...args],
    node: process.version,
    started: new Date().toISOString(),
  };
  taken.set(p, new Set(loadedUrls()));
  return p;
}

/**
 * The provenance of a merge step, with the modules and packages that each shard's process loaded
 * (from the shards' sidecars). Throws when a shard ran at another commit or on another Node
 * version, or records another sha256 for a file.
 */
export function mergeShards(p: Provenance, shards: readonly Provenance[]): Provenance {
  const files: Record<string, string> = { ...p.files };
  const packages = new Set(p.packages);
  for (const shard of shards) {
    if (shard.commit !== p.commit)
      throw new Error(`a shard ran at commit ${shard.commit}, the merge at ${p.commit}`);
    if (shard.node !== p.node)
      throw new Error(`a shard ran on Node ${shard.node}, the merge on ${p.node}`);
    for (const [file, hash] of Object.entries(shard.files)) {
      if (files[file] !== undefined && files[file] !== hash)
        throw new Error(`${file} has sha256 ${hash} in a shard, ${files[file]} in the merge`);
      files[file] = hash;
    }
    for (const pkg of shard.packages) packages.add(pkg);
  }
  const merged: Provenance = {
    ...p,
    files: Object.fromEntries(Object.entries(files).toSorted(([a], [b]) => a.localeCompare(b))),
    packages: [...packages].toSorted(),
  };
  const before = taken.get(p);
  if (before !== undefined) taken.set(merged, before);
  return merged;
}

/**
 * Writes the sidecar of `output`. `complete` is true once the output is final; then the sidecar
 * also records the output's sha256. Throws when the run loaded a module after `p` was taken, since
 * the sidecar would not pin it.
 */
export function writeMeta(
  output: string,
  p: Provenance,
  complete: boolean,
  extra: Readonly<Record<string, unknown>> = {},
): void {
  const before = taken.get(p);
  if (before === undefined) throw new Error("the provenance was not taken in this process");
  for (const url of loadedUrls() ?? [])
    if (!before.has(url))
      throw new Error(
        `${fileURLToPath(url)} was loaded after the provenance was taken; take it after the study's imports`,
      );
  const meta = {
    ...p,
    ...extra,
    output: path.basename(output),
    complete,
    ...(complete ? { outputSha256: sha256(readFileSync(output)) } : {}),
  };
  writeFileSync(metaPath(output), `${JSON.stringify(meta, null, 2)}\n`);
}
