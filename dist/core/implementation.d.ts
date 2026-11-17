import type { Digest } from "../contracts/primitives.ts";
import type { SuiteV2 } from "../contracts/records/suite-v2.ts";
import { type PinnedLoads } from "./load-record.ts";
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
export declare function moduleImplementation(module: string, root: string, options?: ModuleImplementationOptions): Promise<ModuleImplementation>;
/**
 * Ichnaea's build identity: the digest of its package name and version and of every code file
 * that it ships, under `codeDir` (by default the running Ichnaea's). Type declarations are left
 * out, since they run no code. Any change to the shipped code or the version changes it.
 */
export declare function buildIdentity(codeDir?: string): Digest;
/**
 * The implementation digest of a built-in scorer: the scorer's name with Ichnaea's build identity
 * (`build`, by default the running Ichnaea's). An Ichnaea upgrade that changes any shipped code
 * changes it, whether or not the scorer's own code changed.
 */
export declare function builtinImplementation(builtin: string, build?: Digest): Digest;
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
export declare function measureImplementation(measure: SuiteV2["measures"][string], context: ImplementationContext): Promise<Digest>;
//# sourceMappingURL=implementation.d.ts.map