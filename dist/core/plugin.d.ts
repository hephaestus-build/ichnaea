import type { MeasuredValue } from "../contracts/primitives.ts";
import type { Case } from "../contracts/records/case.ts";
import type { Judge } from "../contracts/records/judge.ts";
import type { GateResult } from "../contracts/records/decision.ts";
import type { MeasureCard, MeasureValue } from "../contracts/records/measure.ts";
import type { Plan } from "../contracts/records/plan.ts";
import type { Trial } from "../contracts/records/trial.ts";
import type { SuiteDefinition } from "../contracts/records/suite-definition.ts";
/** A known-good or known-bad example for a measure's tester (REQ-33). */
export interface MeasureExample {
    /** The example's name, which the tester's failure messages quote. */
    readonly name: string;
    /** The case that the example scores. */
    readonly case: Case;
    /** The trial of that case that the measure scores. */
    readonly trial: Trial;
    /** The value the measure must give. */
    readonly expected: MeasuredValue | "not-applicable" | "missing";
}
/**
 * A measure: a card and, for measures Ichnaea computes, a scoring function. A measure computed by
 * the application (`card.computedBy: "application"`) has no scoring function; its values are
 * imported (REQ-31).
 */
export interface MeasureDefinition<Id extends string = string> {
    /** The measure's card without `schema`, which the host adds when it validates the card. */
    readonly card: Omit<MeasureCard, "schema" | "id"> & {
        readonly id: Id;
    };
    /** Whether the measure applies to a case. Absent means it applies to every case. */
    readonly appliesTo?: (c: Case) => boolean;
    /**
     * For a proportion measure: how many items a case has (for example the findings it expects), so
     * a failed trial counts as 0 of that many. Absent means 1.
     */
    readonly items?: (c: Case) => number;
    /** Scores one trial of one case. Returns undefined when the trial carries no value. */
    readonly score?: (trial: Trial, c: Case) => MeasuredValue | undefined;
    /** Files that influence this scorer, resolved from the configuration directory. */
    readonly instrument?: {
        readonly files: readonly string[];
    };
    /** Fixtures used to qualify a primary measure before a locked plan runs. */
    readonly examples?: {
        readonly good: readonly MeasureExample[];
        readonly bad: readonly MeasureExample[];
        readonly nothing?: readonly MeasureExample[];
        readonly incomplete?: readonly MeasureExample[];
    };
}
/** A deterministic check whose failure gives REGRESSION (a hard gate). */
export interface GateDefinition<Id extends string = string> {
    /** The gate's ID, namespaced as `<plugin id>/…`. */
    readonly id: Id;
    /** The gate's version, recorded in a run's lineage. */
    readonly version: string;
    /** What the gate checks, in one sentence. */
    readonly description: string;
    /** The check itself. Core runs it over the run's trials and records the result under `id`. */
    readonly check?: (input: {
        readonly trials: readonly Trial[];
        readonly cases: readonly Case[];
    }) => Omit<GateResult, "gate">;
}
/** What an importer reads and returns. */
export interface ImportInput {
    /** The resolved plan whose trial IDs the importer reads. */
    readonly plan?: Plan;
    /** The paths of the other runner's result files. */
    readonly files: readonly string[];
    /**
     * Options for the importer; `importRun` passes the plan's `arms` (name and identity) and the
     * `run` ID.
     */
    readonly options: Readonly<Record<string, unknown>>;
}
/** Records an importer produces from another runner's files. */
export interface ImportResult {
    /** The trial records, one for each planned trial that the files hold. */
    readonly trials: readonly Trial[];
    /** The values of the measures that the application computes. */
    readonly values: readonly MeasureValue[];
    /** The results of the hard gates that have no check; absent means none. */
    readonly gates?: readonly GateResult[];
    /** The versioned instruments that produced any judge-sourced values. */
    readonly judges?: readonly Judge[];
}
/**
 * Turns another runner's output files into trial records and measure values. A record whose output
 * was not captured is an `infrastructure_failure` with error kind `NOT_CAPTURED`, never `completed`;
 * import enforces this for a completed record with neither `output` nor `pointer`. A
 * `system_failure` or `budget_exceeded` trial never carries a passing value: import refuses one.
 */
export interface Importer<Id extends string = string> {
    /** The importer's ID, namespaced as `<plugin id>/…`. */
    readonly id: Id;
    /** The importer's version, recorded in a run's lineage. */
    readonly version: string;
    /** What the importer reads, in one sentence. */
    readonly description: string;
    /** Reads the files and returns their records. */
    readonly run: (input: ImportInput) => Promise<ImportResult>;
}
/** A plugin: an explicit, typed object listed in the configuration. */
export interface Plugin<Id extends string = string> {
    /** The plugin's ID: lowercase letters, digits and hyphens. It namespaces the plugin's parts. */
    readonly id: Id;
    /** The plugin's version, recorded in a run's lineage. */
    readonly version: string;
    /** Peer ranges of the contracts (major) and core (minor) this plugin supports. */
    readonly requires?: {
        readonly contracts?: string;
        readonly core?: string;
    };
    /** The measures that the plugin provides. */
    readonly measures?: readonly MeasureDefinition<`${Id}/${string}`>[];
    /** The gates that the plugin provides. */
    readonly gates?: readonly GateDefinition<`${Id}/${string}`>[];
    /** The importers that the plugin provides. */
    readonly importers?: readonly Importer<`${Id}/${string}`>[];
}
/**
 * Defines a plugin, keeping its literal ID and the literal IDs of its parts. The ID is inferred from
 * `id` alone, so a part outside the plugin's namespace is a type error.
 */
export declare function definePlugin<const Id extends string, const P extends Plugin<Id>>(plugin: P & {
    readonly id: Id;
} & Plugin<NoInfer<Id>>): P;
/** Defines a measure, keeping its literal ID. */
export declare function defineMeasure<const Id extends `${string}/${string}`>(measure: MeasureDefinition<Id>): MeasureDefinition<Id>;
/** The measure IDs a list of plugins provides. */
export type MeasureIdsOf<Plugins extends readonly Plugin[]> = Plugins[number] extends infer P ? P extends {
    readonly measures: readonly MeasureDefinition<infer Id>[];
} ? Id : never : never;
/** The gate IDs a list of plugins provides. */
export type GateIdsOf<Plugins extends readonly Plugin[]> = Plugins[number] extends infer P ? P extends {
    readonly gates: readonly GateDefinition<infer Id>[];
} ? Id : never : never;
/** An Ichnaea configuration with an explicit plugin list. */
export interface Config<Plugins extends readonly Plugin[] = readonly Plugin[]> {
    /** The plugins to load, listed explicitly. */
    readonly plugins: Plugins;
    /** Suite run and plan commands use. */
    readonly suite?: SuiteDefinition;
    /** Where records are stored. */
    readonly store?: string;
}
/** Defines a configuration. The measures it can name are inferred from its plugins. */
export declare function defineConfig<const Plugins extends readonly Plugin[]>(config: Config<Plugins>): Config<Plugins>;
//# sourceMappingURL=plugin.d.ts.map