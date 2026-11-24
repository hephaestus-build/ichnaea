import { stat } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import * as z from "zod";

import { SuiteDefinition } from "../contracts/records/suite-definition.ts";

import { type Arguments, CliError, text } from "./command-grammar.ts";
import { createHost, type Host } from "./host.ts";
import type { Config, Plugin } from "./plugin.ts";
import { CORE_VERSION } from "./version.ts";

/** Loads a module by URL. The CLI uses `import()`; a test injects another. */
export type ModuleLoader = (url: string) => Promise<unknown>;

export const importModule: ModuleLoader = (url) => import(url);

const NODE_WITHOUT_FLAG = "24.3";
const DEFAULT_CONFIG = "ichnaea.config.ts";

const ConfigModule = z.looseObject({
  default: z.looseObject({
    plugins: z.array(z.custom<Plugin>((value) => typeof value === "object" && value !== null)),
    store: z.string().min(1).optional(),
    suite: SuiteDefinition.optional(),
    records: z.string().min(1).optional(),
  }),
});

/** Loads the configuration file and validates the shape of its default export. */
export async function loadConfig(path: string, load: ModuleLoader = importModule): Promise<Config> {
  let module: unknown;
  try {
    module = await load(pathToFileURL(resolve(path)).href);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ERR_UNKNOWN_FILE_EXTENSION" &&
      extname(path) === ".ts"
    )
      throw new Error(
        `${path} is TypeScript, and this Node (${process.version}) cannot run it: Ichnaea needs Node ${NODE_WITHOUT_FLAG} or later to load a .ts configuration`,
        { cause: error },
      );
    throw error;
  }
  const parsed = ConfigModule.safeParse(module);
  if (!parsed.success)
    throw new Error(`${path} must export a configuration (defineConfig) as default`);
  const { store, suite, records, ...config } = parsed.data.default;
  return {
    ...config,
    ...(store === undefined ? {} : { store }),
    ...(suite === undefined ? {} : { suite }),
    ...(records === undefined ? {} : { records }),
  };
}

async function configuration(
  path: string,
  load: ModuleLoader,
  optional: boolean,
): Promise<{ config: Config; file: string } | undefined> {
  const file = resolve(path);
  try {
    const status = await stat(file).catch((cause: unknown) => {
      if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT")
        return undefined;
      throw cause;
    });
    if (!status) {
      if (optional) return undefined;
      throw new CliError(
        "CONFIGURATION",
        `no ${basename(file)} in ${dirname(file)}; see the README's quick start`,
      );
    }
    if (!status.isFile()) throw new Error(`${file} is not a file`);
    return { config: await loadConfig(path, load), file };
  } catch (cause) {
    if (cause instanceof CliError) throw cause;
    throw new CliError(
      "CONFIGURATION",
      `configuration error: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

type Loaded = Awaited<ReturnType<typeof configuration>>;

/** Flags resolve relative to the caller. A configured store resolves relative to its file. */
function resolveStore(args: Arguments, loaded?: Loaded): string {
  const store = text(args, "store");
  if (store !== undefined) return store;
  return loaded?.config.store === undefined
    ? ".ichnaea"
    : resolve(dirname(loaded.file), loaded.config.store);
}

export async function storeFor(args: Arguments, load: ModuleLoader): Promise<string> {
  const config = text(args, "config");
  if (text(args, "store") !== undefined) return resolveStore(args);
  return resolveStore(
    args,
    await configuration(config ?? DEFAULT_CONFIG, load, config === undefined),
  );
}

export async function hostAndStore(
  args: Arguments,
  load: ModuleLoader,
): Promise<{ host: Host; store: string; config: Config; directory: string }> {
  const loaded = await configuration(text(args, "config") ?? DEFAULT_CONFIG, load, false);
  if (!loaded) throw new CliError("CONFIGURATION", "the configuration is required");
  let host: Host;
  try {
    host = createHost(loaded.config, { core: CORE_VERSION, contracts: CORE_VERSION });
  } catch (cause) {
    throw new CliError(
      "CONFIGURATION",
      `configuration error: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  return {
    host,
    store: resolveStore(args, loaded),
    config: loaded.config,
    directory: dirname(loaded.file),
  };
}
