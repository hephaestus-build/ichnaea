// Provenance of a study's output file: the commit it ran from, the sha256 of each script it ran,
// its seed base and its arguments, in a sidecar `<output>.meta.json`. The sidecar keeps the output
// itself unchanged, so a rerun can be compared with an earlier output byte for byte.
//
// A study refuses to run when a tracked file has uncommitted changes, or when a script it runs is
// not tracked, so the commit names the code that ran. Untracked files (outputs, node_modules) do
// not count. `scripts/check-sweep-provenance.ts` checks a sidecar against the scripts at HEAD.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

export const PROVENANCE_SCHEMA = "ichnaea.stats-provenance/1";

/** What a sidecar records about the run that wrote its output. */
export interface Provenance {
  readonly schema: typeof PROVENANCE_SCHEMA;
  /** The script that ran, relative to the repository root. */
  readonly script: string;
  /** `git rev-parse HEAD` when the run started. */
  readonly commit: string;
  /** The sha256 of the script and of each local module it imports transitively, by repository path. */
  readonly files: Readonly<Record<string, string>>;
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

/** The relative module specifiers of a source text: static imports, re-exports and `import("…")`. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g;

/**
 * Every local module that `files` import, directly or through other local modules, as sorted
 * absolute paths, with `files` themselves. Only relative specifiers count: packages and `node:`
 * built-ins are not part of the repository's code.
 */
export function localImportClosure(files: readonly string[]): string[] {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    const real = realpathSync(file);
    if (seen.has(real)) return;
    seen.add(real);
    for (const [, specifier] of readFileSync(real, "utf8").matchAll(SPECIFIER))
      if (specifier !== undefined) visit(path.resolve(path.dirname(real), specifier));
  };
  for (const file of files) visit(file);
  return [...seen].toSorted();
}

/**
 * The provenance of a run of `script`. It records the script, every local module it imports
 * transitively (so a later change to the statistics it calls invalidates the output), and the
 * extra files `imports` (absolute paths). Throws when a tracked file has uncommitted changes or a
 * recorded file is not tracked.
 */
export function provenance(
  script: string,
  imports: readonly string[],
  seedBase: number | null,
  args: readonly string[],
): Provenance {
  const root = repoRoot(script);
  const dirty = git(["status", "--porcelain", "--untracked-files=no"], root);
  if (dirty !== "")
    throw new Error(`tracked files have uncommitted changes; commit them first:\n${dirty}`);
  const files: Record<string, string> = {};
  for (const file of localImportClosure([script, ...imports])) {
    const relative = path.relative(root, realpathSync(file));
    git(["ls-files", "--error-unmatch", "--", relative], root);
    files[relative] = sha256(readFileSync(file));
  }
  return {
    schema: PROVENANCE_SCHEMA,
    script: path.relative(root, realpathSync(script)),
    commit: git(["rev-parse", "HEAD"], root),
    files,
    seedBase,
    arguments: [...args],
    node: process.version,
    started: new Date().toISOString(),
  };
}

/**
 * Writes the sidecar of `output`. `complete` is true once the output is final; then the sidecar
 * also records the output's sha256.
 */
export function writeMeta(
  output: string,
  p: Provenance,
  complete: boolean,
  extra: Readonly<Record<string, unknown>> = {},
): void {
  const meta = {
    ...p,
    ...extra,
    output: path.basename(output),
    complete,
    ...(complete ? { outputSha256: sha256(readFileSync(output)) } : {}),
  };
  writeFileSync(metaPath(output), `${JSON.stringify(meta, null, 2)}\n`);
}
