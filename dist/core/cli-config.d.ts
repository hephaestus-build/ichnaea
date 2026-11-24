import { type Arguments } from "./command-grammar.ts";
import { type Host } from "./host.ts";
import type { Config } from "./plugin.ts";
/** Loads a module by URL. The CLI uses `import()`; a test injects another. */
export type ModuleLoader = (url: string) => Promise<unknown>;
export declare const importModule: ModuleLoader;
/** Loads the configuration file and validates the shape of its default export. */
export declare function loadConfig(path: string, load?: ModuleLoader): Promise<Config>;
export declare function storeFor(args: Arguments, load: ModuleLoader): Promise<string>;
export declare function hostAndStore(args: Arguments, load: ModuleLoader): Promise<{
    host: Host;
    store: string;
    config: Config;
    directory: string;
}>;
//# sourceMappingURL=cli-config.d.ts.map