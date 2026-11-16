import type {
  Case,
  DataClass,
  Decision,
  GateResult,
  MeasureCard,
  MeasuredValue,
  MeasureValue,
  Plan,
  Purpose,
  Run,
  Trial,
} from "@hephaestus-build/ichnaea-contracts";

/** Stability of a plugin or of one of its parts. Names never encode the stage. */
export type Stability = "development" | "alpha" | "beta" | "stable";

/** A known-good or known-bad example for a measure's tester (REQ-33). */
export interface MeasureExample {
  readonly name: string;
  readonly case: Case;
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
  readonly card: Omit<MeasureCard, "schema" | "id"> & { readonly id: Id };
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
  readonly id: Id;
  readonly version: string;
  readonly description: string;
  /** The check itself. Core runs it over the run's trials and records the result under `id`. */
  readonly check?: (input: {
    readonly trials: readonly Trial[];
    readonly cases: readonly Case[];
  }) => Omit<GateResult, "gate">;
}

/** What an importer reads and returns. */
export interface ImportInput {
  readonly files: readonly string[];
  readonly options: Readonly<Record<string, unknown>>;
}

/** Records an importer produces from another runner's files. */
export interface ImportResult {
  readonly trials: readonly Trial[];
  readonly values: readonly MeasureValue[];
  readonly gates?: readonly GateResult[];
}

/**
 * Turns another runner's output files into trial records and measure values. A record whose output
 * was not captured is an `infrastructure_failure` with error kind `NOT_CAPTURED`, never `completed`;
 * import enforces this for a completed record with neither `output` nor `pointer`. A
 * `system_failure` or `budget_exceeded` trial never carries a passing value: import refuses one.
 */
export interface Importer<Id extends string = string> {
  readonly id: Id;
  readonly version: string;
  readonly description: string;
  readonly run: (input: ImportInput) => Promise<ImportResult>;
}

/** An operation that moves data across a boundary (REQ-126). */
export interface EgressRequest {
  readonly operation: "sample" | "label-publish" | "promote" | "export" | "share" | "model-call";
  readonly purpose: Purpose;
  readonly dataClass: DataClass;
  readonly destination: string;
  readonly pointers: readonly string[];
}

/**
 * A plugin's answer to an egress request. Any plugin can refuse; only the plugin that the
 * configuration names as `governance` can allow data above class `none` to leave.
 */
export type EgressAnswer =
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: string }
  | undefined;

/** The context every hook receives. */
export interface HookContext {
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
  readonly planCreated: (
    ctx: HookContext,
    plan: Plan,
  ) => PlanAdditions | void | Promise<PlanAdditions | void>;
  /** Parallel. After each trial record is written. */
  readonly trialRecorded: (ctx: HookContext, trial: Trial) => void | Promise<void>;
  /** Sequential. After the ledger is complete. */
  readonly runCompleted: (ctx: HookContext, run: Run) => void | Promise<void>;
  /** Parallel. After the decision record exists. */
  readonly decisionMade: (ctx: HookContext, decision: Decision) => void | Promise<void>;
  /** Parallel. After reports are written. */
  readonly reportRendered: (ctx: HookContext, files: readonly string[]) => void | Promise<void>;
  /** Sequential; any plugin can refuse. Before any operation moves data across a boundary. */
  readonly beforeEgress: (
    ctx: HookContext,
    request: EgressRequest,
  ) => EgressAnswer | Promise<EgressAnswer>;
}

/** Execution mode of each hook. */
export const HOOK_MODES: { readonly [K in keyof Hooks]: "sequential" | "parallel" } = {
  configResolved: "sequential",
  planCreated: "sequential",
  trialRecorded: "parallel",
  runCompleted: "sequential",
  decisionMade: "parallel",
  reportRendered: "parallel",
  beforeEgress: "sequential",
};

/** A command a plugin adds to the CLI. */
export interface CommandDefinition {
  readonly name: string;
  readonly description: string;
  /** Options in the shape of `node:util` `parseArgs`. */
  readonly options: Readonly<
    Record<
      string,
      {
        readonly type: "string" | "boolean";
        readonly multiple?: boolean;
        readonly description: string;
      }
    >
  >;
  readonly run: (
    args: {
      readonly values: Readonly<Record<string, unknown>>;
      readonly positionals: readonly string[];
    },
    host: CommandHost,
  ) => Promise<number>;
}

/** What a command can use from the host. */
export interface CommandHost {
  readonly measures: ReadonlyMap<string, MeasureDefinition>;
  readonly importers: ReadonlyMap<string, Importer>;
  readonly gates: ReadonlyMap<string, GateDefinition>;
  readonly hooks: HookRunner;
  readonly out: (text: string) => void;
}

/** Runs hooks across plugins. */
export interface HookRunner {
  configResolved(): Promise<void>;
  planCreated(plan: Plan): Promise<Plan>;
  trialRecorded(trial: Trial): Promise<void>;
  runCompleted(run: Run): Promise<void>;
  decisionMade(decision: Decision): Promise<void>;
  reportRendered(files: readonly string[]): Promise<void>;
  beforeEgress(request: EgressRequest): Promise<{ allow: boolean; reasons: string[] }>;
}

/** A plugin: an explicit, typed object listed in the configuration. */
export interface Plugin<Id extends string = string> {
  readonly id: Id;
  readonly version: string;
  readonly stability: Stability;
  /** Peer ranges of the contracts (major) and core (minor) this plugin supports. */
  readonly requires?: { readonly contracts?: string; readonly core?: string };
  readonly measures?: readonly MeasureDefinition<`${Id}/${string}`>[];
  readonly gates?: readonly GateDefinition<`${Id}/${string}`>[];
  readonly importers?: readonly Importer<`${Id}/${string}`>[];
  readonly commands?: readonly CommandDefinition[];
  readonly hooks?: Partial<Hooks>;
  /** `pre` runs before plugins without placement, `post` after. */
  readonly placement?: "pre" | "post";
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
export function definePlugin<const Id extends string, const P extends Plugin<Id>>(
  plugin: P & { readonly id: Id } & Plugin<NoInfer<Id>>,
): P {
  return plugin;
}

/** Defines a measure, keeping its literal ID. */
export function defineMeasure<const Id extends `${string}/${string}`>(
  measure: MeasureDefinition<Id>,
): MeasureDefinition<Id> {
  return measure;
}

/** The measure IDs a list of plugins provides. */
export type MeasureIdsOf<Plugins extends readonly Plugin[]> = Plugins[number] extends infer P
  ? P extends { readonly measures: readonly MeasureDefinition<infer Id>[] }
    ? Id
    : never
  : never;

/** The gate IDs a list of plugins provides. */
export type GateIdsOf<Plugins extends readonly Plugin[]> = Plugins[number] extends infer P
  ? P extends { readonly gates: readonly GateDefinition<infer Id>[] }
    ? Id
    : never
  : never;

/** An Ichnaea configuration: the explicit plugin list and the stages it opts into. */
export interface Config<Plugins extends readonly Plugin[] = readonly Plugin[]> {
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
export function defineConfig<const Plugins extends readonly Plugin[]>(
  config: Config<Plugins>,
): Config<Plugins> {
  return config;
}
