import { MeasureCard } from "../contracts/records/measure.ts";

import type { Config, GateDefinition, Importer, MeasureDefinition, Plugin } from "./plugin.ts";
import { satisfies } from "./semver.ts";

/** Thrown when a configuration cannot load. The message names the plugin. */
export class HostError extends Error {
  /** The error's name, for `instanceof`-free checks. */
  override readonly name = "HostError";
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

function register<T>(map: Map<string, T>, id: string, value: T, owner: Plugin, kind: string): void {
  if (!id.startsWith(`${owner.id}/`))
    throw new HostError(
      `plugin '${owner.id}': ${kind} '${id}' must be namespaced as '${owner.id}/…'`,
    );
  if (map.has(id)) throw new HostError(`plugin '${owner.id}': duplicate ${kind} '${id}'`);
  map.set(id, value);
}

const CONFIG_KEYS: ReadonlySet<string> = new Set(["plugins", "store"] satisfies (keyof Config)[]);
const PLUGIN_KEYS: ReadonlySet<string> = new Set([
  "id",
  "version",
  "requires",
  "measures",
  "gates",
  "importers",
] satisfies (keyof Plugin)[]);

function checkFields(value: object, supported: ReadonlySet<string>, label: string): void {
  const unknown = Object.keys(value).filter((key) => !supported.has(key));
  if (unknown.length > 0)
    throw new HostError(`${label}: unsupported field(s): ${unknown.join(", ")}`);
}

/** Registers the measure, gate and importer contributions in an explicit configuration. */
export function createHost(config: Config, versions: HostVersions): Host {
  checkFields(config, CONFIG_KEYS, "configuration");
  const ids = new Set<string>();
  const measures = new Map<string, MeasureDefinition>();
  const gates = new Map<string, GateDefinition>();
  const importers = new Map<string, Importer>();
  for (const plugin of config.plugins) {
    checkFields(plugin, PLUGIN_KEYS, `plugin '${plugin.id}'`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(plugin.id))
      throw new HostError(`plugin '${plugin.id}': an ID is lowercase letters, digits and hyphens`);
    if (ids.has(plugin.id)) throw new HostError(`plugin '${plugin.id}' is listed twice`);
    ids.add(plugin.id);
    for (const [what, range] of Object.entries(plugin.requires ?? {})) {
      const offered = what === "core" ? versions.core : versions.contracts;
      if (range && !satisfies(offered, range))
        throw new HostError(
          `plugin '${plugin.id}' requires ${what} ${range}, but ${offered} is loaded`,
        );
    }
    for (const m of plugin.measures ?? []) {
      if (!m.card) throw new HostError(`plugin '${plugin.id}': a measure has no card`);
      const card = MeasureCard.safeParse({ schema: "ichnaea.measureCard/1", ...m.card });
      if (!card.success)
        throw new HostError(
          `plugin '${plugin.id}': the card of measure '${m.card.id}' is invalid: ${card.error.issues[0]?.path.join(".") ?? ""} ${card.error.issues[0]?.message ?? ""}`,
        );
      register(measures, m.card.id, m, plugin, "measure");
    }
    for (const g of plugin.gates ?? []) register(gates, g.id, g, plugin, "gate");
    for (const i of plugin.importers ?? []) register(importers, i.id, i, plugin, "importer");
  }
  return { plugins: config.plugins, measures, gates, importers };
}
