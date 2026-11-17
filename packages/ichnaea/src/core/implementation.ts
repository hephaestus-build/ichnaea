// The implementation digest of a measure: the digest of the code that computes its values, the
// second part of its identity beside its definition. It depends on what computes the measure:
// - an instrument process: the instrument's pin in the lock (`instrumentImplementation`);
// - a TypeScript module: the modules that the module loads when it is imported, recorded in a
//   child process, with each third-party package by version and files (`moduleImplementation`),
//   and the pin of the instrument that holds it. The pin's `files` cover what the module reaches
//   only when it scores: a lazy import, a data file it reads, a script it runs;
// - a built-in scorer, and a stage status, which Ichnaea derives: Ichnaea's build identity
//   (`builtinImplementation`).
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as z from "zod";

import { digest } from "../contracts/canonical.ts";
import { instrumentImplementation } from "../contracts/identity.ts";
import type { Digest } from "../contracts/primitives.ts";
import type { SuiteV2 } from "../contracts/records/suite-v2.ts";

import { type PinnedLoads, readPackage } from "./load-record.ts";

/** What a module measure's module loads, pinned, and the digest over it. */
export interface ModuleImplementation extends PinnedLoads {
  /** The digest of the loads: the canonical digest of `files` and `packages`. */
  readonly digest: Digest;
}

/** Options of `moduleImplementation`. */
export interface ModuleImplementationOptions {
  /** How long the module may take to load before its process is killed. Default one minute. */
  readonly timeoutMs?: number;
}

// The child that records a module's loads, beside this module in src/ and in dist/.
const CHILD = fileURLToPath(
  new URL(`./load-module${path.extname(fileURLToPath(import.meta.url))}`, import.meta.url),
);
// The tag of the child's message. The child exits right after it sends its record, so its record
// is the last tagged message; one that the module sends while it loads comes earlier.
const LOADS = "ichnaea.loads";
const LOAD_TIMEOUT_MS = 60_000;
// How much of the child's standard error an error keeps: its end, where the error is.
const STDERR_LIMIT = 8 * 1024;
// The child's whole environment. NODE_OPTIONS could preload a module before the recorder, which
// would then miss it, and a secret has no business in a module that only loads.
const ENVIRONMENT = ["PATH", "HOME"];

const Hashes = z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/));
/** The child's record of the loads, as pinLoads writes it. */
const PinnedLoadsMessage = z.strictObject({
  files: Hashes,
  packages: z.record(
    z.string(),
    z.strictObject({ importedBy: z.array(z.string()), files: Hashes }),
  ),
});

/**
 * The digest of what a TypeScript or JavaScript module loads when it is imported: the sha256 of
 * every local module that `module` loads, by its path from `root`, and every third-party package
 * that it loads, by `name@version` with the sha256 of each file loaded from it. The module is
 * imported in a fresh child process with the load recorder in place and only PATH and HOME in its
 * environment. An import that runs while the module loads counts, a type-only import does not,
 * and code the module reaches only when it scores is not seen: a measure's implementation adds its
 * instrument's pin for that (`measureImplementation`). Rejects when the module does not load
 * within the time limit (then its process is killed), throws while it loads, loads worker threads
 * or a local module outside `root`, or when the child's record is malformed.
 */
export function moduleImplementation(
  module: string,
  root: string,
  options: ModuleImplementationOptions = {},
): Promise<ModuleImplementation> {
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(
      ENVIRONMENT.flatMap((name) => {
        const value = process.env[name];
        return value === undefined ? [] : [[name, value]];
      }),
    );
    const child = fork(CHILD, [path.resolve(module), root], {
      env,
      execArgv: [],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      timeout: options.timeoutMs ?? LOAD_TIMEOUT_MS,
      // A module can ignore SIGTERM; it cannot ignore SIGKILL.
      killSignal: "SIGKILL",
    });
    let stderr = "";
    let loads: PinnedLoads | undefined;
    let settled = false;
    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      finish();
    };
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_LIMIT);
    });
    child.on("message", (message: unknown) => {
      if (!Object.hasOwn(Object(message), LOADS)) return;
      const parsed = PinnedLoadsMessage.safeParse(Reflect.get(Object(message), LOADS));
      if (parsed.success) {
        loads = parsed.data;
        return;
      }
      child.kill("SIGKILL");
      settle(() =>
        reject(new Error(`the child sent a malformed record of the loads of ${module}`)),
      );
    });
    child.on("error", (error) => settle(() => reject(error)));
    // Settle on exit, not on close: a process that the module started can hold standard error open.
    child.on("exit", (code, signal) => {
      const finish = (): void =>
        settle(() =>
          code === 0 && loads !== undefined
            ? resolve({ ...loads, digest: digest(loads) })
            : reject(
                new Error(
                  `the loads of ${module} could not be recorded (${signal ?? `exit ${code}`}):\n${stderr.trim()}`,
                ),
              ),
        );
      const { stderr: pipe } = child;
      if (pipe === null || pipe.readableEnded) return finish();
      const wait = setTimeout(finish, 1000);
      pipe.once("end", () => {
        clearTimeout(wait);
        finish();
      });
    });
  });
}

const CODE = /\.(?:js|mjs|cjs|ts|mts|cts)$/;
const DECLARATION = /\.d\.(?:ts|mts|cts)$/;

/** The source in src/ that a code file under a code directory comes from. */
const sourceOf = (relative: string): string => relative.replace(/\.([mc]?)js$/, ".$1ts");

/**
 * The sha256 of every code file under `dir` that the package ships, in hex, by its path from
 * `dir`. A file ships when its source is in the package's src/, so a leftover in dist/ from a
 * source that is gone is left out, and so are type declarations. A run from src/ hashes the
 * sources and a run from dist/ the built files, so the two have different build identities.
 */
function codeFiles(dir: string): Record<string, string> {
  const sources = path.join(dir, "..", "src");
  const files: Record<string, string> = {};
  for (const relative of readdirSync(dir, { recursive: true, encoding: "utf8" }).toSorted()) {
    const file = path.join(dir, relative);
    if (!CODE.test(relative) || DECLARATION.test(relative) || !statSync(file).isFile()) continue;
    if (!existsSync(path.join(sources, sourceOf(relative)))) continue;
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
 * stage status from the build; a module from the modules it loads and the pin of the instrument
 * that holds it; an instrument's dimension from the instrument's pin. Rejects when the instrument
 * has no pin, or when the measure names neither a scorer nor a stage status, which `suiteProblems`
 * refuses first (`MEASURE_NOT_COMPUTED`).
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
  const pin = context.instruments[scorer.instrument];
  if (pin === undefined)
    throw new Error(`the lock has no pin for instrument '${scorer.instrument}'`);
  if (!("module" in scorer)) return instrumentImplementation(pin);
  const { files, packages } = await moduleImplementation(
    path.join(context.suiteDir, scorer.module),
    context.root,
  );
  return digest({ loads: { files, packages }, instrument: instrumentImplementation(pin) });
}
