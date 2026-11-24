import { type Command, type CommandResult } from "./command-grammar.ts";
import { FileStore } from "./store.ts";
export declare const decideCommand: Command;
export declare function decideRun(store: FileStore, run: string, output?: string, now?: string): Promise<CommandResult>;
export declare const reportCommand: Command;
export declare function writeRunReport(store: FileStore, run: string, format?: string, output?: string, jsonOnly?: boolean, ratingsPath?: string): Promise<CommandResult>;
//# sourceMappingURL=commands.d.ts.map