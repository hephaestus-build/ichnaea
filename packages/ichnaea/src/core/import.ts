import { readFile } from "node:fs/promises";

import {
  Case,
  CaseSet,
  canonicalize,
  Configuration,
  type Decision,
  digest,
  type GateResult,
  type MeasureValue,
  type Plan,
  proportionProblem,
  Run,
  Suite,
  type Trial,
} from "../contracts/index.ts";

import type { Host } from "./host.ts";
import { scoreTrials } from "./measures.ts";
import { createPlan } from "./planner.ts";
import { recordProblems } from "./records.ts";
import { FileStore, StoreError } from "./store.ts";

/** What `ichnaea import` needs. */
export interface ImportRunInput {
  /** The loaded configuration that provides the importer, measures and gates. */
  readonly host: Host;
  /** The directory of the file store that the run is written to. */
  readonly store: string;
  /** The ID of the run to create. */
  readonly run: string;
  /** The ID of the importer that reads the result files. */
  readonly importer: string;
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

/**
 * The error kind of a trial whose output was not captured. Such a trial is an infrastructure
 * failure, never a completed trial: it counts as missing, never as a failure of the system.
 */
export const NOT_CAPTURED = "not-captured";

/** Outcomes that score as a failed trial, whatever value a record carries (REQ-20). */
const FAILED_OUTCOMES: ReadonlySet<string> = new Set(["system_failure", "budget_exceeded"]);

/** Thrown when an importer's records cannot be stored. The message names the record. */
export class ImportError extends Error {
  /** The error's name, for `instanceof`-free checks. */
  override readonly name = "ImportError";
}

async function json(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new ImportError(`${path}: ${(error as Error).message}`);
  }
}

/**
 * Marks a trial whose configuration differs from its arm, or whose observations differ from what
 * the configuration expects (REQ-15), as an invalid configuration. Its outputs stay recorded; it
 * gives no value, so it counts as missing. A protocol failure stays one: it is the harness's fault
 * and makes the run INVALID, which an invalid configuration, counted only as missing, would not.
 */
function checkConfiguration(trial: Trial, identity: string | undefined): Trial {
  if (trial.outcome === "invalid_configuration" || trial.outcome === "protocol_failure")
    return trial;
  const mismatch =
    identity !== trial.configuration
      ? `the trial ran configuration ${trial.configuration}, not its arm's ${identity ?? "(no arm)"}`
      : trial.observed
          ?.filter(
            (o) => o.expected !== undefined && canonicalize(o.value) !== canonicalize(o.expected),
          )
          .map((o) => `observed ${o.name} differs from the expected value`)[0];
  if (mismatch === undefined) return trial;
  return {
    ...trial,
    outcome: "invalid_configuration",
    error: { kind: "configuration-mismatch", message: mismatch },
  };
}

/**
 * A trial is scored only on output that was captured (REQ-20). A completed record with neither
 * an output nor a pointer to one is a capture failure: an infrastructure failure, so it counts as
 * missing. An output the system returned empty is present, and is scored.
 */
function checkCaptured(trial: Trial): Trial {
  if (trial.outcome !== "completed" || trial.output !== undefined || trial.pointer !== undefined)
    return trial;
  return {
    ...trial,
    outcome: "infrastructure_failure",
    error: { kind: NOT_CAPTURED, message: "the record has no captured output" },
  };
}

/** Whether a value says that its trial passed: a binary pass, or a proportion with a success. */
function passing(value: MeasureValue["value"]): boolean {
  return (
    (value?.type === "binary" && value.pass) ||
    (value?.type === "proportion" && value.successes > 0)
  );
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
  const importer = host.importers.get(input.importer);
  if (!importer)
    throw new ImportError(
      `no importer '${input.importer}'; the plugins provide: ${[...host.importers.keys()].join(", ") || "none"}`,
    );
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
  const store = new FileStore(input.store);
  const aa = await citations(store, input.aa ?? []);
  const plan = await host.planCreated(
    await createPlan({
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
    }),
  );

  const result = await importer.run({
    files: input.files,
    options: {
      arms: plan.arms.map((a) => ({ name: a.name, identity: a.identity })),
      run: input.run,
    },
  });

  // Trials: each one a planned trial, with the planned case, arm and replicate.
  const planned = new Map(plan.trials.map((t) => [t.id as string, t]));
  const identities = new Map(plan.arms.map((a) => [a.name as string, a.identity as string]));
  const trials = result.trials.map((t) => {
    const p = planned.get(t.id);
    if (!p)
      throw new ImportError(`the importer returned trial '${t.id}', which the plan does not list`);
    if (t.case !== p.case || t.arm !== p.arm || t.replicate !== p.replicate)
      throw new ImportError(
        `trial '${t.id}' is planned as case '${p.case}', arm '${p.arm}', replicate ${p.replicate}`,
      );
    return checkCaptured(checkConfiguration(t, identities.get(p.arm)));
  });
  const byTrial = new Map(trials.map((t) => [t.id as string, t]));

  // Values: imported ones for measures the application computes, scored ones for Ichnaea's.
  const planMeasures = new Set(plan.measures.map((m) => m.id));
  for (const v of result.values) {
    const measure = host.measures.get(v.measure);
    if (!measure || !planMeasures.has(v.measure))
      throw new ImportError(`value for measure '${v.measure}', which the plan does not use`);
    if (measure.card.computedBy === "ichnaea")
      throw new ImportError(
        `measure '${v.measure}' is computed by Ichnaea; do not import its values`,
      );
    if (v.version !== measure.card.version)
      throw new ImportError(
        `value for '${v.measure}' on '${v.trial}' has version ${v.version}, but the card is ${measure.card.version}`,
      );
    if (!byTrial.has(v.trial))
      throw new ImportError(
        `value for '${v.measure}' names trial '${v.trial}', which was not imported`,
      );
    if (!v.applicable) continue;
    if (v.value === undefined)
      throw new ImportError(`value for '${v.measure}' on '${v.trial}' is applicable but empty`);
    if (v.value.type !== measure.card.valueType)
      throw new ImportError(
        `value for '${v.measure}' on '${v.trial}' is ${v.value.type}, but the card says ${measure.card.valueType} (REQ-31)`,
      );
    const problem = proportionProblem(v.value);
    if (problem) throw new ImportError(`value for '${v.measure}' on '${v.trial}': ${problem}`);
    const outcome = byTrial.get(v.trial)?.outcome ?? "not_run";
    // A record that contradicts itself is a defect in the importer, not evidence about the system.
    if (FAILED_OUTCOMES.has(outcome) && passing(v.value))
      throw new ImportError(
        `trial '${v.trial}' is a ${outcome} but carries a passing value for '${v.measure}'; a failed trial cannot pass, so fix the importer`,
      );
  }
  const byCase = new Map(cases.map((c) => [c.id as string, c]));
  const valid = new Set(
    trials.filter((t) => t.outcome !== "invalid_configuration").map((t) => t.id),
  );
  const values: MeasureValue[] = [
    ...result.values,
    ...scoreTrials(
      [...host.measures.values()].filter((m) => planMeasures.has(m.card.id)),
      trials,
      byCase,
    ),
  ].filter((v) => valid.has(v.trial));

  // Gates: a gate with a check is computed here; the importer reports only gates without one.
  const gates: GateResult[] = [];
  for (const g of result.gates ?? []) {
    const definition = host.gates.get(g.gate);
    if (!definition || !plan.hardGates.includes(g.gate))
      throw new ImportError(`gate result for '${g.gate}', which the plan does not use`);
    if (definition.check)
      throw new ImportError(`gate '${g.gate}' is computed by its check; do not import its result`);
    gates.push(g);
  }
  for (const id of plan.hardGates) {
    const check = host.gates.get(id)?.check;
    if (check) gates.push({ ...check({ trials, cases }), gate: id });
  }
  for (const g of gates)
    if (g.passed === g.failures > 0)
      throw new ImportError(
        `gate '${g.gate}': passed is ${g.passed} with ${g.failures} failure(s)`,
      );

  const problems = recordProblems({ trials, values, gates });
  if (problems.length > 0) throw new ImportError(problems.join("; "));

  const recorded = new Map(trials.map((t) => [t.id as string, t.outcome]));
  const lineage: Run["lineage"] = [
    ...host.plugins.map((p) => ({ kind: "plugin" as const, id: p.id, version: p.version })),
    { kind: "plugin", id: importer.id, version: importer.version },
    ...plan.measures,
    ...plan.hardGates.map((id) => ({
      kind: "gate" as const,
      id,
      version: host.gates.get(id)?.version ?? "unknown",
    })),
    { kind: "package", id: "@hephaestus-build/ichnaea", version: input.ichnaea },
  ];
  const run = Run.parse({
    schema: "ichnaea.run/1",
    id: input.run,
    plan: await digest(plan),
    exploratory: false,
    environment: {
      node: process.versions.node,
      platform: `${process.platform}-${process.arch}`,
      ichnaea: input.ichnaea,
      arch: process.arch,
      runtime: {
        name: "node",
        version: process.versions.node,
        platform: process.platform,
        arch: process.arch,
      },
    },
    arms: plan.arms,
    lineage,
    ledger: plan.trials.map((t) => {
      const outcome = recorded.get(t.id);
      // A planned trial the importer did not return never ran.
      return outcome
        ? { trial: t.id, state: "recorded", outcome }
        : { trial: t.id, state: "planned", outcome: "not_run" };
    }),
    startedAt: input.now,
    completedAt: input.now,
  });

  await store.createRun({ plan, run, trials, values, gates });
  for (const t of trials) await host.trialRecorded(t);
  await host.runCompleted(run);
  return { plan, trials: trials.length, values: values.length };
}
