import type { Config } from "./plugin.ts";
/** Loads a module by URL. The CLI uses `import()`; a test injects another. */
export type ModuleLoader = (url: string) => Promise<unknown>;
/** Loads `ichnaea.config.ts` (or another file) and returns its default export. */
export declare function loadConfig(path: string, load?: ModuleLoader): Promise<Config>;
/**
 * Runs the CLI. Returns the exit code: 0 on success, 1 when a command's policy blocks, 2 on any
 * error, so an error never reads as a policy result.
 */
export declare function main(argv: readonly string[], out?: (text: string) => void, load?: ModuleLoader): Promise<number>;
//# sourceMappingURL=cli.d.ts.map