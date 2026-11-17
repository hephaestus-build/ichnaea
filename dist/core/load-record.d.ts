/** What the hooks recorded: the URLs loaded, and for each loaded file the modules that resolved it. */
export interface LoadRecord {
    /** Every `file:` URL loaded, and `node:worker_threads` when it was loaded. */
    readonly loaded: ReadonlySet<string>;
    /** For each loaded file, the URLs of the modules that resolved it. */
    readonly resolvedBy: ReadonlyMap<string, ReadonlySet<string>>;
}
/**
 * Starts recording the modules that this process loads from now on. A second call records nothing
 * more: the hooks are registered once.
 */
export declare function recordLoads(): void;
/** The record of this process's loads, or undefined when nothing records them. */
export declare function loadRecord(): LoadRecord | undefined;
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
export declare function readPackage(packageJson: string): InstalledPackage;
/** The installed package that holds `file`, or undefined outside node_modules. */
export declare function packageOf(file: string): InstalledPackage | undefined;
/** The key of an installed package in a pinned set: `name@version`. */
export declare const packageKey: (pkg: InstalledPackage) => string;
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
/**
 * Pins what `record` holds: each local module by its path from `root` and its sha256, and each
 * package by `name@version` with its importers and the sha256 of each file loaded from it. Throws
 * when the process loaded worker threads, whose loads are not recorded, or a local module outside
 * `root`.
 */
export declare function pinLoads(record: LoadRecord, root: string): PinnedLoads;
//# sourceMappingURL=load-record.d.ts.map