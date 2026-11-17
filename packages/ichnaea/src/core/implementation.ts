// The implementation digest of a measure: the digest of the code that computes its values, the
// second part of its identity beside its definition. It depends on what computes the measure:
// - an instrument process: the instrument's pin in the lock (`instrumentImplementation`);
// - a TypeScript module: the modules that the module loads, recorded in a child process, with
//   each third-party package by version and files (`moduleImplementation`);
// - a built-in scorer, and a stage status, which Ichnaea derives: Ichnaea's build identity
//   (`builtinImplementation`).
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { digest } from "../contracts/canonical.ts";
import { instrumentImplementation } from "../contracts/identity.ts";
import type { Digest } from "../contracts/primitives.ts";
import type { SuiteV2 } from "../contracts/records/suite-v2.ts";

import { type PinnedLoads, readPackage } from "./load-record.ts";

/** What a module measure's module loads, pinned, and the digest over it. */
export interface ModuleImplementation extends PinnedLoads {
  /** The implementation digest: the canonical digest of `files` and `packages`. */
  readonly digest: Digest;
}

// The child that records a module's loads, beside this module in src/ and in dist/.
const CHILD = fileURLToPath(
  new URL(`./load-module${path.extname(fileURLToPath(import.meta.url))}`, import.meta.url),
);
// The tag of the child's message, so that a message the module itself sends is not taken for it.
const LOADS = "ichnaea.loads";
const LOAD_TIMEOUT_MS = 60_000;

/**
 * The implementation digest of a measure defined in a TypeScript or JavaScript module: the sha256
 * of every local module that `module` loads, by its path from `root`, and every third-party package
 * that it loads, by `name@version` with the sha256 of each file loaded from it. The module is
 * imported in a fresh child process with the load recorder in place, so a dynamic import counts
 * and a type-only import does not. Rejects when the module does not load within a minute, throws
 * while it loads, loads worker threads, or loads a local module outside `root`.
 */
export function moduleImplementation(module: string, root: string): Promise<ModuleImplementation> {
  return new Promise((resolve, reject) => {
    const child = fork(CHILD, [path.resolve(module), root], {
      execArgv: [],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      timeout: LOAD_TIMEOUT_MS,
    });
    let stderr = "";
    let settled = false;
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("message", (message: unknown) => {
      const loads: unknown = Reflect.get(Object(message), LOADS);
      if (settled || loads === undefined) return;
      settled = true;
      child.kill();
      const { files, packages } = loads as PinnedLoads;
      resolve({ files, packages, digest: digest({ files, packages }) });
    });
    child.on("error", (error) => {
      if (!settled) reject(error);
      settled = true;
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          `the loads of ${module} could not be recorded (${signal ?? `exit ${code}`}):\n${stderr.trim()}`,
        ),
      );
    });
  });
}

const CODE = /\.(?:js|mjs|cjs|ts|mts|cts)$/;
const DECLARATION = /\.d\.(?:ts|mts|cts)$/;

/**
 * The sha256 of every code file under `dir`, in hex, by its path from `dir`; type declarations
 * left out.
 */
function codeFiles(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const relative of readdirSync(dir, { recursive: true, encoding: "utf8" }).toSorted()) {
    const file = path.join(dir, relative);
    if (!CODE.test(relative) || DECLARATION.test(relative) || !statSync(file).isFile()) continue;
    files[relative.split(path.sep).join("/")] = createHash("sha256")
      .update(readFileSync(file))
      .digest("hex");
  }
  return files;
}

// The directory that holds the running Ichnaea's code: src/ when it runs from source, dist/ when
// it runs from its build. Its package.json sits one directory above.
const RUNNING_CODE = fileURLToPath(new URL("../", import.meta.url));
let running: Digest | undefined;

/**
 * Ichnaea's build identity: the digest of its package name and version and of every code file
 * that it ships, under `codeDir` (by default the running Ichnaea's). Type declarations are left
 * out, since they run no code. Any change to the shipped code or the version changes it.
 */
export function buildIdentity(codeDir?: string): Digest {
  if (codeDir === undefined) return (running ??= buildIdentity(RUNNING_CODE));
  const { name, version } = readPackage(path.join(codeDir, "..", "package.json"));
  return digest({ package: `${name}@${version}`, files: codeFiles(codeDir) });
}

/**
 * The implementation digest of a built-in scorer: the scorer's name with Ichnaea's build identity
 * (`build`, by default the running Ichnaea's). An Ichnaea upgrade that changes any shipped code
 * changes it, whether or not the scorer's own code changed.
 */
export function builtinImplementation(builtin: string, build: Digest = buildIdentity()): Digest {
  return digest({ builtin, build });
}

/** The name under which a stage status measure takes its implementation from the build. */
const STAGE_STATUS = "stage-status";

/** Where a measure's code is found, for `measureImplementation`. */
export interface ImplementationContext {
  /** The suite file's directory, which a module measure's path is relative to. */
  readonly suiteDir: string;
  /** The root that a module measure's loaded modules are named from, such as the repository. */
  readonly root: string;
  /** Each instrument's pin, as the lock holds it. */
  readonly instruments: Readonly<Record<string, unknown>>;
}

/**
 * The implementation digest of a measure of a suite, by what computes it: a built-in scorer or a
 * stage status from the build, a module from the modules it loads, and an instrument's dimension
 * from the instrument's pin. Rejects when the instrument has no pin, or when the measure names
 * neither a scorer nor a stage status.
 */
export async function measureImplementation(
  measure: SuiteV2["measures"][string],
  context: ImplementationContext,
): Promise<Digest> {
  const { scorer } = measure;
  if (scorer === undefined) {
    if (measure.stage !== undefined && measure.status !== undefined)
      return builtinImplementation(STAGE_STATUS);
    throw new Error(
      "the measure names neither a scorer nor a stage status, so nothing is known to compute it",
    );
  }
  if ("builtin" in scorer) return builtinImplementation(scorer.builtin);
  if ("module" in scorer)
    return (await moduleImplementation(path.join(context.suiteDir, scorer.module), context.root))
      .digest;
  const pin = context.instruments[scorer.instrument];
  if (pin === undefined)
    throw new Error(`the lock has no pin for instrument '${scorer.instrument}'`);
  return instrumentImplementation(pin);
}
