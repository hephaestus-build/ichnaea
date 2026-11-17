// Provenance of a study's output file, in a sidecar `<output>.meta.json`: the commit it ran from,
// the pull request whose head holds that commit, the sha256 of every local module its process
// loaded, every third-party package it loaded (its version, the modules that imported it and the
// sha256 of each file it loaded), the Node version, its seed base and its arguments. The sidecar
// keeps the output itself unchanged, so a rerun can be compared with an earlier output byte for
// byte.
//
// The modules are the ones the process loads, recorded and pinned by the package's load recorder
// (src/core/load-record.ts), which the study starts by preloading record-loads.ts with
// `node --import`. A module that is not loaded cannot change the output, so a
// change to it needs no rerun. No module the study loads may only re-export: a barrel would pin
// every file it re-exports, so a module imports the file that defines what it uses (a lint rule
// holds that too). A study must not compute in worker threads, whose loads are not recorded, and
// must not read a repository file as data: the sidecar would not pin it.
//
// A study refuses to run when a tracked file has uncommitted changes, or when a module it loads is
// not tracked, so the commit names the code that ran. Untracked files (outputs, node_modules) do
// not count. check-sweep-provenance.ts checks a sidecar against the repository at HEAD.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadRecord, pinLoads, type PinnedPackage } from "../../src/core/load-record.ts";

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
  /** Every third-party package the run loaded, by `name@version`. */
  readonly packages: Readonly<Record<string, PinnedPackage>>;
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

const byKey = <T>(record: Readonly<Record<string, T>>): Record<string, T> =>
  Object.fromEntries(Object.entries(record).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * What the run has loaded so far, pinned by the package's load recorder: the local modules with
 * their sha256, and the packages. Throws when the loads were not recorded from the run's start,
 * when the recorder cannot pin them, or when a local module is untracked or only re-exports.
 */
function loadedSet(root: string, script: string): Pick<Provenance, "files" | "packages"> {
  const record = loadRecord();
  if (record === undefined || !record.loaded.has(pathToFileURL(realpathSync(script)).href))
    throw new Error(
      `the run did not record its loaded modules from its start; run it as ${RECORD_LOADS} <script> …`,
    );
  let pinned;
  try {
    pinned = pinLoads(record, root);
  } catch (error) {
    throw new Error(`the study's loads cannot be pinned: ${(error as Error).message}`, {
      cause: error,
    });
  }
  for (const file of Object.keys(pinned.files)) {
    git(["ls-files", "--error-unmatch", "--", file], root);
    if (reexportsOnly(readFileSync(path.join(root, file), "utf8")))
      throw new Error(`${file} only re-exports; import the file that defines what the study uses`);
  }
  return pinned;
}

/** The loaded URLs when each provenance was taken, so that a later load is refused. */
const taken = new WeakMap<Provenance, ReadonlySet<string>>();

/**
 * The provenance of a run of `script`: the commit, every module the process has loaded so far,
 * and every package among them. Call it after the study's imports. Throws when the loaded modules
 * were not recorded from the start, when the run loaded worker threads, when a tracked file has
 * uncommitted changes, or when a loaded module is not tracked or only re-exports. `pull` is the
 * pull request whose head holds the commit; a published output needs it.
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
  taken.set(p, new Set(loadRecord()?.loaded));
  return p;
}

/**
 * The provenance that the sidecar of a complete output records, for example a shard's. Throws when
 * the output is not complete or has other bytes than the sidecar records.
 */
export function readProvenance(output: string): Provenance {
  const meta = JSON.parse(readFileSync(metaPath(output), "utf8")) as Provenance & {
    readonly complete?: unknown;
    readonly outputSha256?: unknown;
  };
  if (meta.complete !== true || meta.outputSha256 !== sha256(readFileSync(output)))
    throw new Error(`${output} is not the complete output that its sidecar records`);
  return meta;
}

/** Throws when a shard's `label` is `a` and the merge's is another, `b`. */
function same(label: string, a: unknown, b: unknown): void {
  if (a !== b) throw new Error(`a shard has ${label} ${String(a)}, the merge ${String(b)}`);
}

/** Adds a shard's sha256 per file to the merge's; throws when one file has two. */
function mergeHashes(
  into: Record<string, string>,
  from: Readonly<Record<string, string>>,
  at = "",
): void {
  for (const [file, hash] of Object.entries(from)) {
    if (into[file] !== undefined && into[file] !== hash)
      throw new Error(`${at}${file} has sha256 ${hash} in a shard, ${into[file]} in the merge`);
    into[file] = hash;
  }
}

/**
 * The provenance of a merge step, with the modules and packages that each shard's process loaded
 * (from the shards' sidecars, `readProvenance`). Throws when a shard has another schema, script,
 * seed base, commit or Node version, or records another sha256 for a file.
 */
export function mergeShards(p: Provenance, shards: readonly Provenance[]): Provenance {
  const files: Record<string, string> = { ...p.files };
  const packages = new Map(
    Object.entries(p.packages).map(([k, v]) => [
      k,
      { importedBy: new Set(v.importedBy), files: { ...v.files } },
    ]),
  );
  for (const shard of shards) {
    same("the schema", shard.schema, p.schema);
    same("the script", shard.script, p.script);
    same("the seed base", shard.seedBase, p.seedBase);
    same("commit", shard.commit, p.commit);
    same("Node", shard.node, p.node);
    mergeHashes(files, shard.files);
    for (const [key, pkg] of Object.entries(shard.packages)) {
      const entry = packages.get(key) ?? { importedBy: new Set<string>(), files: {} };
      packages.set(key, entry);
      for (const by of pkg.importedBy) entry.importedBy.add(by);
      mergeHashes(entry.files, pkg.files, `${key}/`);
    }
  }
  const merged: Provenance = {
    ...p,
    files: byKey(files),
    packages: byKey(
      Object.fromEntries(
        [...packages].map(([key, v]) => [
          key,
          { importedBy: [...v.importedBy].toSorted(), files: byKey(v.files) },
        ]),
      ),
    ),
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
  for (const url of loadRecord()?.loaded ?? [])
    if (!before.has(url))
      throw new Error(
        `${url.startsWith("file:") ? fileURLToPath(url) : url} was loaded after the provenance was taken; ` +
          "take it after the study's imports",
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
