import { type ModuleLoader } from "./core/cli-config.ts";
export { loadConfig, type ModuleLoader } from "./core/cli-config.ts";
/** Runs one command and writes its result after the handler finishes. */
export declare function main(argv: readonly string[], out?: (text: string) => void, load?: ModuleLoader, err?: (text: string) => void): Promise<number>;
//# sourceMappingURL=cli.d.ts.map