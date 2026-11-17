import type { DataClass, Purpose } from "../contracts/data-class.ts";
import type { MeasuredValue } from "../contracts/primitives.ts";
import type { Case } from "../contracts/records/case.ts";
import type { Decision, GateResult } from "../contracts/records/decision.ts";
import type { MeasureCard, MeasureValue } from "../contracts/records/measure.ts";
import type { Plan } from "../contracts/records/plan.ts";
import type { Run } from "../contracts/records/run.ts";
import type { Trial } from "../contracts/records/trial.ts";
/** Stability of a plugin or of one of its parts. Names never encode the stage. */
export type Stability = "development" | "alpha" | "beta" | "stable";
/** A known-good or known-bad example for a measure's tester (REQ-33). */
export interface MeasureExample {
    /** The example's name, which the tester's failure messages quote. */
    readonly name: string;
    /** The case that the example scores. */
    readonly case: Case;
    /** The trial of that case that the measure scores. */
    readonly trial: Trial;
    /** The value the measure must give. */
    readonly expected: MeasuredValue | "not-applicable";
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
    /** Known-good and known-bad examples. A measure is primary only when its tester passes. */
    readonly examples?: {
        readonly good: readonly MeasureExample[];
        readonly bad: readonly MeasureExample[];
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
/** An operation that moves data across a boundary (REQ-126). */
export interface EgressRequest {
    /** The kind of operation that moves the data. */
    readonly operation: "sample" | "label-publish" | "promote" | "export" | "share" | "model-call";
    /** The purpose of processing that the operation serves. */
    readonly purpose: Purpose;
    /** The most sensitive data class that the operation moves. */
    readonly dataClass: DataClass;
    /** Where the data goes; the host quotes it in its log lines. */
    readonly destination: string;
    /** Pointers to the records that the operation moves (REQ-126). */
    readonly pointers: readonly string[];
}
/**
 * A plugin's answer to an egress request. Any plugin can refuse; only the plugin that the
 * configuration names as `governance` can allow data above class `none` to leave.
 */
export type EgressAnswer = {
    readonly allow: true;
} | {
    readonly allow: false;
    readonly reason: string;
} | undefined;
/** The context every hook receives. */
export interface HookContext {
    /** Writes one message to the host's log. */
    readonly log: (message: string) => void;
}
/**
 * What a `planCreated` hook may add to a plan before any call: a power statement, or a switch to
 * estimate-only with its reasons. A hook can never turn an estimate-only plan into a decision.
 */
export type PlanAdditions = Partial<Pick<Plan, "power" | "modeReasons">> & {
    readonly mode?: "estimate-only";
    readonly refuse?: string;
};
/**
 * The seven lifecycle hooks. Sequential hooks run in plugin order (with `pre` and `post`
 * placement); parallel hooks run together.
 */
export interface Hooks {
    /** Sequential. After presets are flattened and options validated. */
    readonly configResolved: (ctx: HookContext) => void | Promise<void>;
    /** Sequential. After the plan exists, before any call. May add a power statement or refuse. */
    readonly planCreated: (ctx: HookContext, plan: Plan) => PlanAdditions | void | Promise<PlanAdditions | void>;
    /** Parallel. After each trial record is written. */
    readonly trialRecorded: (ctx: HookContext, trial: Trial) => void | Promise<void>;
    /** Sequential. After the ledger is complete. */
    readonly runCompleted: (ctx: HookContext, run: Run) => void | Promise<void>;
    /** Parallel. After the decision record exists. */
    readonly decisionMade: (ctx: HookContext, decision: Decision) => void | Promise<void>;
    /** Parallel. After reports are written. */
    readonly reportRendered: (ctx: HookContext, files: readonly string[]) => void | Promise<void>;
    /** Sequential; any plugin can refuse. Before any operation moves data across a boundary. */
    readonly beforeEgress: (ctx: HookContext, request: EgressRequest) => EgressAnswer | Promise<EgressAnswer>;
}
/** Execution mode of each hook. */
export declare const HOOK_MODES: {
    readonly [K in keyof Hooks]: "sequential" | "parallel";
};
/** A command a plugin adds to the CLI. */
export interface CommandDefinition {
    /** The command's name on the command line; it cannot be a core command. */
    readonly name: string;
    /** What the command does, in one sentence. */
    readonly description: string;
    /** Options in the shape of `node:util` `parseArgs`. */
    readonly options: Readonly<Record<string, {
        readonly type: "string" | "boolean";
        readonly multiple?: boolean;
        readonly description: string;
    }>>;
    /** Runs the command with its parsed arguments and returns the exit code. */
    readonly run: (args: {
        readonly values: Readonly<Record<string, unknown>>;
        readonly positionals: readonly string[];
    }, host: CommandHost) => Promise<number>;
}
/** What a command can use from the host. */
export interface CommandHost {
    /** The configuration's measures, by card ID. */
    readonly measures: ReadonlyMap<string, MeasureDefinition>;
    /** The configuration's importers, by importer ID. */
    readonly importers: ReadonlyMap<string, Importer>;
    /** The configuration's gates, by gate ID. */
    readonly gates: ReadonlyMap<string, GateDefinition>;
    /** Runs the plugins' hooks. */
    readonly hooks: HookRunner;
    /** Writes one line of the command's output. */
    readonly out: (text: string) => void;
}
/** Runs hooks across plugins. */
export interface HookRunner {
    /** Runs the `configResolved` hooks in plugin order. */
    configResolved(): Promise<void>;
    /** Runs the `planCreated` hooks in plugin order and returns the plan with their additions. */
    planCreated(plan: Plan): Promise<Plan>;
    /** Runs the `trialRecorded` hooks together. */
    trialRecorded(trial: Trial): Promise<void>;
    /** Runs the `runCompleted` hooks in plugin order. */
    runCompleted(run: Run): Promise<void>;
    /** Runs the `decisionMade` hooks together. */
    decisionMade(decision: Decision): Promise<void>;
    /** Runs the `reportRendered` hooks together with the paths of the written reports. */
    reportRendered(files: readonly string[]): Promise<void>;
    /**
     * Asks the `beforeEgress` hooks in plugin order and returns whether the data may leave, with the
     * reasons for a refusal.
     */
    beforeEgress(request: EgressRequest): Promise<{
        allow: boolean;
        reasons: string[];
    }>;
}
/** A plugin: an explicit, typed object listed in the configuration. */
export interface Plugin<Id extends string = string> {
    /** The plugin's ID: lowercase letters, digits and hyphens. It namespaces the plugin's parts. */
    readonly id: Id;
    /** The plugin's version, recorded in a run's lineage. */
    readonly version: string;
    /** The plugin's stability. A configuration loads a plugin below `stable` only when it opts in. */
    readonly stability: Stability;
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
    /** The CLI commands that the plugin adds. */
    readonly commands?: readonly CommandDefinition[];
    /** The lifecycle hooks that the plugin implements. */
    readonly hooks?: Partial<Hooks>;
    /** `pre` runs before plugins without placement, `post` after. */
    readonly placement?: "pre" | "post";
    /**
     * Present when the plugin is deprecated: since when, the version that removes it, its replacement
     * and a URL. The host warns at load.
     */
    readonly deprecated?: {
        readonly since: string;
        readonly removeIn: string;
        readonly replacement: string;
        readonly url: string;
    };
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
/** An Ichnaea configuration: the explicit plugin list and the stages it opts into. */
export interface Config<Plugins extends readonly Plugin[] = readonly Plugin[]> {
    /** The plugins to load, listed explicitly. */
    readonly plugins: Plugins;
    /** Stability levels below `stable` that this configuration accepts (REQ-80). */
    readonly allowStability?: readonly Exclude<Stability, "stable">[];
    /** Where records are stored. */
    readonly store?: string;
    /**
     * The ID of the plugin that decides data egress for the deployment (REQ-126). Only its
     * `beforeEgress` can allow data above class `none` to leave; any plugin can refuse. The
     * configuration grants this, never the plugin itself, so a plugin cannot open egress by
     * declaring itself trusted.
     */
    readonly governance?: string;
}
/** Defines a configuration. The measures it can name are inferred from its plugins. */
export declare function defineConfig<const Plugins extends readonly Plugin[]>(config: Config<Plugins>): Config<Plugins>;
//# sourceMappingURL=plugin.d.ts.map