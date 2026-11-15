import { fileURLToPath } from "node:url";

/**
 * Resolves `@hephaestus-build/ichnaea-<name>` to `packages/<name>/src/index.ts` in tests, as
 * `paths` does for the type checker, so tests run against sources without a build.
 */
export const workspaceAlias: Array<{ find: RegExp; replacement: string }> = [
  {
    find: /^@hephaestus-build\/ichnaea-([a-z-]+)$/,
    replacement: fileURLToPath(new URL("./packages/$1/src/index.ts", import.meta.url)),
  },
];
