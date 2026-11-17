// Records what a process loads as modules, and pins what it recorded: the sha256 of each local
// module, and each third-party package by `name@version` with the sha256 of the files it loaded.
// A study's provenance (scripts/stats/provenance.ts) and a measure's implementation digest
// (implementation.ts) both read this record.
//
// The hooks see a module that loads after `recordLoads()`: a static import, a dynamic import
// whatever its specifier, and a file of a package under node_modules, each with the modules that
// resolved it. A type-only import never loads, so it is not recorded. The record also notes a load
// of node:worker_threads: a worker thread has its own loader, so what it loads is not recorded.
// Nothing loaded before the hooks is recorded, this module and its Node built-ins included, so it
// imports nothing local.
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** What the hooks recorded: the URLs loaded, and for each loaded file the modules that resolved it. */
export interface LoadRecord {
  /** Every `file:` URL loaded, and `node:worker_threads` when it was loaded. */
  readonly loaded: ReadonlySet<string>;
  /** For each loaded file, the URLs of the modules that resolved it. */
  readonly resolvedBy: ReadonlyMap<string, ReadonlySet<string>>;
}

// The key under which the record lives on the global object. A study's provenance reads the record
// by this key, so it must not change while committed study outputs pin that reader.
const LOADED_MODULES = Symbol.for("ichnaea.stats.loaded-modules");

/**
 * Starts recording the modules that this process loads from now on. A second call records nothing
 * more: the hooks are registered once.
 */
export function recordLoads(): void {
  if (loadRecord() !== undefined) return;
  const record = { loaded: new Set<string>(), resolvedBy: new Map<string, Set<string>>() };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const result = nextResolve(specifier, context);
      const { parentURL } = context;
      if (parentURL !== undefined && result.url.startsWith("file:")) {
        const parents = record.resolvedBy.get(result.url) ?? new Set<string>();
        record.resolvedBy.set(result.url, parents.add(parentURL));
      }
      return result;
    },
    load(url, context, nextLoad) {
      if (url.startsWith("file:") || url === "node:worker_threads") record.loaded.add(url);
      return nextLoad(url, context);
    },
  });
  Object.defineProperty(globalThis, LOADED_MODULES, { value: record });
}

/** The record of this process's loads, or undefined when nothing records them. */
export function loadRecord(): LoadRecord | undefined {
  const value: unknown = Reflect.get(globalThis, LOADED_MODULES);
  const loaded: unknown = Reflect.get(Object(value), "loaded");
  const resolvedBy: unknown = Reflect.get(Object(value), "resolvedBy");
  return loaded instanceof Set && resolvedBy instanceof Map
    ? { loaded: loaded as Set<string>, resolvedBy: resolvedBy as Map<string, Set<string>> }
    : undefined;
}

/** An installed package: its name, its version and its directory. */
export interface InstalledPackage {
  /** The name in its package.json. */
  readonly name: string;
  /** The version in its package.json. */
  readonly version: string;
  /** The directory that holds its package.json. */
  readonly dir: string;
}

/** The installed package whose directory holds `packageJson`, read from that manifest. */
export function readPackage(packageJson: string): InstalledPackage {
  const manifest: unknown = JSON.parse(readFileSync(packageJson, "utf8"));
  const name: unknown = Reflect.get(Object(manifest), "name");
  const version: unknown = Reflect.get(Object(manifest), "version");
  if (typeof name !== "string" || typeof version !== "string")
    throw new Error(`${packageJson} names no package and version`);
  return { name, version, dir: path.dirname(packageJson) };
}

const NODE_MODULES = `${path.sep}node_modules${path.sep}`;

/** The installed package that holds `file`, or undefined outside node_modules. */
export function packageOf(file: string): InstalledPackage | undefined {
  const at = file.lastIndexOf(NODE_MODULES);
  if (at < 0) return undefined;
  const parts = file.slice(at + NODE_MODULES.length).split(path.sep);
  const name = parts[0]?.startsWith("@") ? `${parts[0]}/${parts[1]}` : (parts[0] ?? "");
  const pkg = readPackage(
    path.join(file.slice(0, at + NODE_MODULES.length), ...name.split("/"), "package.json"),
  );
  if (pkg.name !== name) throw new Error(`${pkg.dir}/package.json names ${pkg.name}, not ${name}`);
  return pkg;
}

/** The key of an installed package in a pinned set: `name@version`. */
export const packageKey = (pkg: InstalledPackage): string => `${pkg.name}@${pkg.version}`;

/** A third-party package that a process loaded. */
export interface PinnedPackage {
  /** The modules that resolved it: paths from the root, or other packages as `name@version`. */
  readonly importedBy: readonly string[];
  /** The sha256 of each file loaded from it, in hex, by path from the package's directory. */
  readonly files: Readonly<Record<string, string>>;
}

/** What a process loaded, pinned by content. */
export interface PinnedLoads {
  /** The sha256 of each local module loaded, in hex, by path from the root with `/` separators. */
  readonly files: Readonly<Record<string, string>>;
  /** Each third-party package loaded, by `name@version`. */
  readonly packages: Readonly<Record<string, PinnedPackage>>;
}

const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

const byKey = <T>(record: Readonly<Record<string, T>>): Record<string, T> =>
  Object.fromEntries(Object.entries(record).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * Pins what `record` holds: each local module by its path from `root` and its sha256, and each
 * package by `name@version` with its importers and the sha256 of each file loaded from it. Throws
 * when the process loaded worker threads, whose loads are not recorded, or a local module outside
 * `root`.
 */
export function pinLoads(record: LoadRecord, root: string): PinnedLoads {
  if (record.loaded.has("node:worker_threads"))
    throw new Error(
      "it loaded worker threads, and the modules a worker thread loads are not recorded",
    );
  const base = realpathSync(root);
  // A loaded file's key: its path from the root, or the package that holds it.
  const keyOf = (url: string): { file: string; pkg?: InstalledPackage; key: string } => {
    const file = realpathSync(fileURLToPath(url));
    const pkg = packageOf(file);
    if (pkg !== undefined) return { file, pkg, key: packageKey(pkg) };
    const relative = path.relative(base, file);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error(`${file} is outside ${base} and outside node_modules`);
    return { file, key: relative.split(path.sep).join("/") };
  };
  const files: Record<string, string> = {};
  const packages: Record<string, { importedBy: Set<string>; files: Record<string, string> }> = {};
  for (const url of record.loaded) {
    if (!url.startsWith("file:")) continue;
    const { file, pkg, key } = keyOf(url);
    const hash = sha256(readFileSync(file));
    if (pkg === undefined) {
      files[key] = hash;
      continue;
    }
    const entry = (packages[key] ??= { importedBy: new Set(), files: {} });
    entry.files[path.relative(pkg.dir, file).split(path.sep).join("/")] = hash;
    for (const parent of record.resolvedBy.get(url) ?? []) {
      if (!parent.startsWith("file:")) continue;
      const by = keyOf(parent).key;
      if (by !== key) entry.importedBy.add(by);
    }
  }
  return {
    files: byKey(files),
    packages: byKey(
      Object.fromEntries(
        Object.entries(packages).map(([key, p]) => [
          key,
          { importedBy: [...p.importedBy].toSorted(), files: byKey(p.files) },
        ]),
      ),
    ),
  };
}
