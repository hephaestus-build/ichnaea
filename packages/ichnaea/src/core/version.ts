import { createRequire } from "node:module";

/**
 * Reads a package's version from its package.json, which sits one directory above both `src/`
 * and `dist/`. `from` is the caller's `import.meta.url`.
 */
export function packageVersion(from: string): string {
  const { version } = createRequire(from)("../package.json") as { version?: unknown };
  if (typeof version !== "string")
    throw new Error(`no version in the package.json next to ${from}`);
  return version;
}

/**
 * The version of the Ichnaea package, checked against plugins' peer ranges. Its package.json sits
 * two directories above this module, in `src/core/` and in `dist/core/`, so the version is read
 * from the parent directory.
 */
export const CORE_VERSION: string = packageVersion(new URL("../", import.meta.url).href);
