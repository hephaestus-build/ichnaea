import { readFile } from "node:fs/promises";

import { digest } from "../contracts/canonical.ts";
import { Case, CaseSet } from "../contracts/records/case.ts";
import { Configuration } from "../contracts/records/configuration.ts";
import type { Decision } from "../contracts/records/decision.ts";
import { Plan } from "../contracts/records/plan.ts";
import { Suite } from "../contracts/records/suite.ts";

import { planningPower } from "../plan/power.ts";

import { bindImportedPlan, type LockedImport } from "./analysis-plan.ts";
import type { Host } from "./host.ts";
import { createPlan } from "./planner.ts";
import { reScoreTrials } from "./re-score.ts";
import { ImportError, recordRun } from "./record-run.ts";
import { FileStore, StoreError } from "./store.ts";

export { ImportError, NOT_CAPTURED } from "./record-run.ts";

/** What `ichnaea import` needs. */
interface ImportRunOptions {
  /** The loaded configuration that provides the importer, measures and gates. */
  readonly host: Host;
  /** Directory of declared scorer files for imports using the inline flags. */
  readonly directory?: string;
  /** The directory of the file store that the run is written to. */
  readonly store: string;
  /** The ID of the run to create. */
  readonly run: string;
  /** The ID of the importer that reads the result files. */
  readonly importer: string;
  /** The other runner's result files that the importer reads. */
  readonly files: readonly string[];
  /** The kind of change that the run evaluates. */
  readonly trigger: Plan["trigger"];
  /** Factor keys the change varies beyond what its trigger varies by kind (REQ-15). */
  readonly varies?: readonly string[];
  /** The schedule the trials ran on: how many ran at once, and the endpoint they called. */
  readonly schedule?: Plan["schedule"];
  /** Decided A/A runs in the store that the plan cites, by run ID (one trial per case). */
  readonly aa?: readonly string[];
  /** The plan's seed, a non-negative integer. */
  readonly seed: number;
  /** The ISO 8601 timestamp recorded as the plan's creation and the run's start and end. */
  readonly now: string;
  /**
   * The Ichnaea version, a semantic version, recorded in the plan, the run's environment and its
   * lineage.
   */
  readonly ichnaea: string;
}

/** Resolve inputs from the locked analysis or from the original inline flags. */
export type ImportRunInput = ImportRunOptions & ({ readonly locked: LockedImport } | LegacyInputs);

interface LegacyInputs {
  /** The path of the suite's JSON file. */
  readonly suite: string;
  /** The path of the case set's JSON file. */
  readonly caseSet: string;
  /** The path of the cases' JSON Lines file, one case per line; blank lines are skipped. */
  readonly cases: string;
  /** The arms, each with its name, role and the path of its configuration's JSON file. */
  readonly arms: ReadonlyArray<{
    readonly name: string;
    readonly role: "base" | "candidate" | "reference";
    readonly configuration: string;
  }>;
}

async function json(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new ImportError(`${path}: ${(error as Error).message}`);
  }
}

/**
 * The plan's citations of decided A/A runs, each by run ID and the digest of its stored decision.
 * A run without a decision cannot be cited.
 */
async function citations(store: FileStore, runs: readonly string[]): Promise<Plan["aa"]> {
  if (runs.length === 0) return undefined;
  const decisions = [];
  for (const run of runs) {
    let decision: Decision | undefined;
    try {
      decision = (await store.read(run)).decision;
    } catch (error) {
      if (!(error instanceof StoreError)) throw error;
    }
    if (!decision)
      throw new ImportError(
        `--aa run '${run}' has no decision in the store; import and decide the A/A run first`,
      );
    decisions.push({ run: decision.run, digest: await digest(decision) });
  }
  return { decisions };
}

async function prepareLegacyImport(
  input: ImportRunOptions & LegacyInputs,
  store: FileStore,
): Promise<{ readonly plan: Plan; readonly cases: readonly Case[] }> {
  const { host } = input;
  const suite = Suite.parse(await json(input.suite));
  const caseSet = CaseSet.parse(await json(input.caseSet));
  const cases = (await readFile(input.cases, "utf8")).split("\n").flatMap((line, i) => {
    if (line.trim() === "") return [];
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new ImportError(`${input.cases}:${i + 1}: not JSON (${(error as Error).message})`);
    }
    const parsed = Case.safeParse(value);
    if (!parsed.success)
      throw new ImportError(
        `${input.cases}:${i + 1}: invalid case: ${parsed.error.issues[0]?.message ?? ""}`,
      );
    return [parsed.data];
  });
  const arms = await Promise.all(
    input.arms.map(async (a) => ({
      name: a.name,
      role: a.role,
      configuration: Configuration.parse(await json(a.configuration)),
    })),
  );
  const aa = await citations(store, input.aa ?? []);
  const draft = await createPlan({
    ...(input.directory === undefined ? {} : { directory: input.directory }),
    suite,
    caseSet,
    cases,
    arms,
    armsToRun: [],
    measures: host.measures,
    gates: host.gates,
    trigger: input.trigger,
    ...(input.varies === undefined ? {} : { varies: input.varies }),
    ...(input.schedule === undefined ? {} : { schedule: input.schedule }),
    ...(aa === undefined ? {} : { aa }),
    seed: input.seed,
    now: input.now,
    ichnaea: input.ichnaea,
  });
  const { refuse, ...power } = planningPower(draft);
  if (refuse !== undefined) throw new ImportError(refuse);
  const plan = Plan.parse({ ...draft, ...power });

  return { plan, cases };
}

/**
 * Import mode (REQ-22): resolves the plan, runs an importer over another runner's result files,
 * scores the measures Ichnaea computes, runs the hard gates that have a check, and stores plan,
 * trials, values, gates and the run with its ledger in one atomic write. Every record is checked
 * before anything is written. Import mode makes no model call, so its worst-case calls are zero.
 */
export async function importRun(
  input: ImportRunInput,
): Promise<{ plan: Plan; trials: number; values: number }> {
  const { host } = input;
  const reScore = input.importer === "ichnaea/re-score";
  const importer = host.importers.get(input.importer);
  if (reScore && (!("locked" in input) || input.files.length !== 1))
    throw new ImportError(
      "ichnaea/re-score requires --plan and one --file containing the source run ID",
    );
  if (!reScore && !importer)
    throw new ImportError(
      `no importer '${input.importer}'; the plugins provide: ${[...host.importers.keys()].join(", ") || "none"}`,
    );
  const store = new FileStore(input.store);
  const { plan, cases } =
    "locked" in input
      ? await bindImportedPlan(input.locked, host, {
          trigger: input.trigger,
          varies: [...(input.varies ?? [])],
          seed: input.seed,
          createdAt: input.now,
          ichnaea: input.ichnaea,
        })
      : await prepareLegacyImport(input, store);

  const sourceId = reScore ? input.files[0] : undefined;
  if (sourceId !== undefined) {
    const source = await store.read(sourceId);
    return recordRun({
      host,
      store,
      plan,
      cases,
      result: { trials: reScoreTrials(source, plan, input.run), values: [] },
      id: input.run,
      execution: { source: "re-score" },
      startedAt: input.now,
      completedAt: input.now,
      producer: {
        kind: "package",
        id: `re-score-source:${source.run.id}`,
        version: source.run.environment.ichnaea,
        digest: digest({ plan: source.plan, run: source.run, trials: source.trials }),
      },
    });
  }
  if (!importer) throw new ImportError("the source run is required");
  const result = await importer.run({
    files: input.files,
    plan,
    options: {
      arms: plan.arms.map((a) => ({ name: a.name, identity: a.identity })),
      run: input.run,
    },
  });

  return recordRun({
    host,
    store,
    plan,
    cases,
    result,
    id: input.run,
    execution: { source: "import" },
    startedAt: input.now,
    completedAt: input.now,
    producer: { kind: "plugin", id: importer.id, version: importer.version },
  });
}
