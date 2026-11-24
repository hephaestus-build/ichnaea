import { parseArgs } from "node:util";

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
  readonly run: (
    args: Arguments,
    load: ModuleLoader,
    diagnostic: (text: string) => void,
  ) => CommandResult | Promise<CommandResult>;
}

export type ErrorCode = z.infer<typeof CliErrorRecord>["code"];

export class CliError extends Error {
  readonly code: ErrorCode;
  readonly publicMessage: string | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options?: ErrorOptions & { readonly publicMessage?: string },
  ) {
    super(message, options);
    this.code = code;
    this.publicMessage = options?.publicMessage;
  }
}

export const COMMON_OPTIONS: Readonly<Record<string, Option>> = {
  help: { type: "boolean", description: "Show help for this command" },
  json: { type: "boolean", description: "Print one JSON document" },
};

export const CONFIG_OPTION: Option = {
  type: "string",
  description: "Configuration file (default ichnaea.config.ts)",
};

export const STORE_OPTION: Option = {
  type: "string",
  description: "Record store (overrides the configuration's store)",
};

type Value = string | boolean | readonly (string | boolean)[] | undefined;

export interface Arguments {
  readonly values: Readonly<Record<string, Value>>;
  readonly positionals: readonly string[];
  readonly worker: readonly string[];
}

export function text(args: Arguments, name: string): string | undefined {
  const value = args.values[name];
  return typeof value === "string" ? value : undefined;
}

export function required(args: Arguments, name: string): string {
  const value = text(args, name);
  if (value === undefined) throw new CliError("USAGE", `--${name} is required`);
  return value;
}

export function many(args: Arguments, name: string): string[] {
  const value = args.values[name];
  return Array.isArray(value) ? value.filter((part) => typeof part === "string") : [];
}

export function splitWorker(argv: readonly string[]): {
  options: string[];
  worker: string[];
  separator: boolean;
} {
  const delimiter = argv.indexOf("--");
  return delimiter < 0
    ? { options: [...argv], worker: [], separator: false }
    : { options: argv.slice(0, delimiter), worker: argv.slice(delimiter + 1), separator: true };
}

/** The mode is known even when strict parsing fails. Worker arguments never select it. */
export function jsonRequested(argv: readonly string[]): boolean {
  return splitWorker(argv).options.some((arg) => arg === "--json" || arg.startsWith("--json="));
}

export function argumentsFor(command: Command, supplied: readonly string[]): Arguments {
  const { options: args, worker, separator } = splitWorker(supplied);
  const options = { ...COMMON_OPTIONS, ...command.options };
  const usage = (message: string): CliError => new CliError("USAGE", `${command.name}: ${message}`);
  const accepted = Object.keys(options)
    .map((key) => `--${key}`)
    .join(", ");
  let parsed;
  try {
    parsed = parseArgs({ args, options, strict: true, allowPositionals: true, tokens: true });
  } catch (cause) {
    const message =
      cause instanceof Error
        ? cause.message.split(". To specify", 1)[0]
        : "invalid command options";
    throw new CliError("USAGE", `${command.name}: ${message}. Options: ${accepted}`, { cause });
  }
  const seen = new Set<string>();
  for (const token of parsed.tokens) {
    if (token.kind !== "option") continue;
    const option = options[token.name];
    if (seen.has(token.name) && !option?.multiple)
      throw usage(`--${token.name} can only be used once`);
    seen.add(token.name);
    if (option?.choices && (token.value === undefined || !option.choices.includes(token.value)))
      throw usage(`--${token.name} must be one of ${option.choices.join(", ")}`);
    if (option?.type === "string" && !token.value) throw usage(`--${token.name} needs a value`);
  }

  if (separator && !command.worker) throw usage("unexpected -- and worker arguments");
  if (parsed.values["help"] !== true) {
    const positionals = command.positionals ?? [];
    const minimum = positionals.length - (command.optionalPositionals ?? 0);
    if (parsed.positionals.length < minimum || parsed.positionals.length > positionals.length) {
      throw usage(
        positionals.length ? `expected ${positionals.join(" ")}` : "unexpected positional argument",
      );
    }
    for (const [name, option] of Object.entries(options))
      if (option.required && !seen.has(name)) throw usage(`--${name} is required`);
    if (command.together) {
      const [first, second] = command.together;
      if (seen.has(first) !== seen.has(second))
        throw usage(`--${first} and --${second} go together`);
    }
    if (command.worker && worker.length === 0) throw usage("a worker command is required after --");
  }
  return { values: parsed.values, positionals: parsed.positionals, worker };
}
