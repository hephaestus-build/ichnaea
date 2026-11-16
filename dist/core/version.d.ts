/**
 * Reads a package's version from its package.json, which sits one directory above both `src/`
 * and `dist/`. `from` is the caller's `import.meta.url`.
 */
export declare function packageVersion(from: string): string;
/**
 * The version of the Ichnaea package, checked against plugins' peer ranges. Its package.json sits
 * two directories above this module, in `src/core/` and in `dist/core/`, so the version is read
 * from the parent directory.
 */
export declare const CORE_VERSION: string;
//# sourceMappingURL=version.d.ts.map