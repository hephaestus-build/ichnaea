import type { Config, GateDefinition, Importer, MeasureDefinition, Plugin } from "./plugin.ts";
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
export interface Host {
    /** The loaded plugins, in configuration order. */
    readonly plugins: readonly Plugin[];
    /** The plugins' measures, by card ID. */
    readonly measures: ReadonlyMap<string, MeasureDefinition>;
    /** The plugins' gates, by gate ID. */
    readonly gates: ReadonlyMap<string, GateDefinition>;
    /** The plugins' importers, by importer ID. */
    readonly importers: ReadonlyMap<string, Importer>;
}
/** Registers the measure, gate and importer contributions in an explicit configuration. */
export declare function createHost(config: Config, versions: HostVersions): Host;
//# sourceMappingURL=host.d.ts.map