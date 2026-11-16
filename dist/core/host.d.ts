import type { CommandDefinition, Config, EgressRequest, GateDefinition, HookContext, HookRunner, Hooks, Importer, MeasureDefinition, Plugin } from "./plugin.ts";
/** Thrown when a configuration cannot load. The message names the plugin. */
export declare class HostError extends Error {
    /** The error's name, for `instanceof`-free checks. */
    readonly name = "HostError";
}
/** The versions a host offers to plugins' peer ranges. */
export interface HostVersions {
    /** The version of the core, checked against each plugin's `requires.core` range. */
    readonly core: string;
    /**
     * The version of the record contracts, checked against each plugin's `requires.contracts` range.
     */
    readonly contracts: string;
}
/** A loaded configuration. */
export interface Host extends HookRunner {
    /** The loaded plugins in hook order: `pre` plugins first, then the unplaced ones, then `post`. */
    readonly plugins: readonly Plugin[];
    /** The plugins' measures, by card ID. */
    readonly measures: ReadonlyMap<string, MeasureDefinition>;
    /** The plugins' gates, by gate ID. */
    readonly gates: ReadonlyMap<string, GateDefinition>;
    /** The plugins' importers, by importer ID. */
    readonly importers: ReadonlyMap<string, Importer>;
    /** The plugins' commands, by command name; the core commands are not in it. */
    readonly commands: ReadonlyMap<string, CommandDefinition>;
    /** The warnings from loading, such as one for each deprecated plugin. */
    readonly warnings: readonly string[];
}
/** Commands the core defines; a plugin cannot replace them. */
export declare const CORE_COMMANDS: readonly string[];
/**
 * Loads a configuration (REQ-80): plugins are listed explicitly, IDs are unique and namespaced,
 * peer ranges and stability opt-ins are checked, and every conflict fails at load time naming the
 * plugin. Deprecated plugins load with a warning that names the replacement.
 */
export declare function createHost(config: Config, versions: HostVersions, log?: (message: string) => void): Host;
/**
 * Runs the `beforeEgress` hooks in order (REQ-126). Any plugin can refuse, and the first refusal
 * wins. Without an explicit allow from the governance plugin that the configuration names, only
 * data classed `none` may leave: default deny. An allow from any other plugin counts for nothing.
 */
export declare function decideEgress(request: EgressRequest, hooks: ReadonlyArray<[Plugin, NonNullable<Hooks["beforeEgress"]>]>, ctx: HookContext, governance?: string): Promise<{
    allow: boolean;
    reasons: string[];
}>;
//# sourceMappingURL=host.d.ts.map