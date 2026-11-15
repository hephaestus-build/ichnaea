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

/** The version of this package, checked against plugins' peer ranges. */
export const CORE_VERSION: string = packageVersion(import.meta.url);
