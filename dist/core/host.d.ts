import type { CommandDefinition, Config, EgressRequest, GateDefinition, HookContext, HookRunner, Hooks, Importer, MeasureDefinition, Plugin } from "./plugin.ts";
/** Thrown when a configuration cannot load. The message names the plugin. */
export declare class HostError extends Error {
    readonly name = "HostError";
}
/** The versions a host offers to plugins' peer ranges. */
export interface HostVersions {
    readonly core: string;
    readonly contracts: string;
}
/** A loaded configuration. */
export interface Host extends HookRunner {
    readonly plugins: readonly Plugin[];
    readonly measures: ReadonlyMap<string, MeasureDefinition>;
    readonly gates: ReadonlyMap<string, GateDefinition>;
    readonly importers: ReadonlyMap<string, Importer>;
    readonly commands: ReadonlyMap<string, CommandDefinition>;
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