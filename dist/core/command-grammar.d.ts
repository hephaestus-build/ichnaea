import type * as z from "zod";
import type { CliErrorRecord } from "../contracts/records/cli.ts";
import type { ModuleLoader } from "./cli-config.ts";
export interface Option {
    readonly description: string;
    readonly type: "boolean" | "string";
    readonly required?: boolean;
    readonly multiple?: boolean;
    readonly choices?: readonly string[];
}
export interface CommandResult {
    readonly code: 0 | 1;
    readonly text: readonly string[];
    readonly json: unknown;
}
export interface Command {
    readonly name: string;
    readonly description: string;
    readonly options: Readonly<Record<string, Option>>;
    readonly positionals?: readonly string[];
    readonly optionalPositionals?: number;
    readonly together?: readonly [string, string];
    readonly worker?: boolean;
    readonly run: (args: Arguments, load: ModuleLoader, diagnostic: (text: string) => void) => CommandResult | Promise<CommandResult>;
}
export type ErrorCode = z.infer<typeof CliErrorRecord>["code"];
export declare class CliError extends Error {
    readonly code: ErrorCode;
    readonly publicMessage: string | undefined;
    constructor(code: ErrorCode, message: string, options?: ErrorOptions & {
        readonly publicMessage?: string;
    });
}
export declare const COMMON_OPTIONS: Readonly<Record<string, Option>>;
export declare const CONFIG_OPTION: Option;
export declare const STORE_OPTION: Option;
type Value = string | boolean | readonly (string | boolean)[] | undefined;
export interface Arguments {
    readonly values: Readonly<Record<string, Value>>;
    readonly positionals: readonly string[];
    readonly worker: readonly string[];
}
export declare function text(args: Arguments, name: string): string | undefined;
export declare function required(args: Arguments, name: string): string;
export declare function many(args: Arguments, name: string): string[];
export declare function splitWorker(argv: readonly string[]): {
    options: string[];
    worker: string[];
    separator: boolean;
};
/** The mode is known even when strict parsing fails. Worker arguments never select it. */
export declare function jsonRequested(argv: readonly string[]): boolean;
export declare function argumentsFor(command: Command, supplied: readonly string[]): Arguments;
export {};
//# sourceMappingURL=command-grammar.d.ts.map