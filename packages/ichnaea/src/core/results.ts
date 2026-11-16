import * as z from "zod";

import {
  Case,
  caseDigest,
  canonicalize,
  type Configuration,
  contractFor,
  digest,
  type MeasureValue,
  type ObservedConfiguration,
  type Outcome,
  readRecord,
  Run,
  type Runtime,
  sha256,
  Timestamp,
  Trial,
  TrialResult,
} from "../contracts/index.ts";

import { checkCaptured, ImportError, NOT_CAPTURED } from "./import-rules.ts";
import { scoreTrials } from "./measures.ts";
import { recordProblems, type RunRecords } from "./records.ts";
import { type SuitePlan, suiteMeasures } from "./suite.ts";

/**
 * A worker's answer for one trial, `ichnaea.trialResult/1`, with the times of the trial when the
 * importer knows them. The result itself carries no times: Ichnaea measures them when it runs the
 * trial, and an importer of results that already exist passes them beside the result. A trial at
 * one trial per case and arm needs both times to check its pair's order.
 */
export interface TimedResult {
  /** The worker's answer, as the worker wrote it. */
  readonly result: TrialResult;
  /** When the trial started, ISO 8601. */
  readonly startedAt?: string;
  /** When the trial ended, ISO 8601. */
  readonly endedAt?: string;
}

/** What `importResults` found, beside the records. */
export interface ImportSummary {
  /** The results read. */
  readonly rows: number;
  /** The trial records made, one per result. */
  readonly trials: number;
  /** The measure values scored. */
  readonly values: number;
  /** The trials by recorded outcome. */
  readonly outcomes: Readonly<Partial<Record<Outcome, number>>>;
  /**
   * The planned trials that no result answered: they are recorded as not run. A trial whose worker
   * reported a protocol failure is not among them.
   */
  readonly notRun: number;
  /**
   * Warnings about the results: completed results that lost their output, results whose observed
   * configuration is not the arm's, with the reason, and protocol failures.
   */
  readonly warnings: readonly string[];
  /** The members some result carried that no record defines, by path, sorted. They are ignored. */
  readonly unused: readonly string[];
}

const Timed = z.looseObject({
  result: z.unknown(),
  startedAt: Timestamp.optional(),
  endedAt: Timestamp.optional(),
});
const TIMED_MEMBERS = new Set(["result", "startedAt", "endedAt"]);

/** The outcome of a trial whose worker reported a failure, by the failure's class. */
const OUTCOME_OF: Readonly<Record<string, Outcome>> = {
  infrastructure: "infrastructure_failure",
  system: "system_failure",
  not_run: "not_run",
};

const UNKNOWN_RUNTIME: Runtime = {
  name: "unknown",
  version: "unknown",
  platform: "unknown",
  arch: "unknown",
};

const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Why a worker's observed configuration is not the arm's planned one, or undefined when it is.
 * Only what the configuration pins is compared:
 * - the code, when the configuration has a `code.commit` or a `code.image` factor;
 * - the model, which must be the ID of one of the arm's models;
 * - the route, when one of the arm's models has one: the observed route is the digest of its
 *   value, or the value itself when that is already a digest;
 * - every observed parameter, which the arm's configuration must hold with the same value.
 */
function observedProblem(
  observed: ObservedConfiguration,
  config: Configuration,
): string | undefined {
  const code: { readonly commit?: string | undefined; readonly image?: string | undefined } =
    observed.code;
  for (const kind of ["commit", "image"] as const) {
    const planned = config.factors[`code.${kind}`]?.value;
    if (planned === undefined) continue;
    const seen = code[kind];
    if (seen !== planned)
      return seen === undefined
        ? `the worker named no ${kind}, but the arm pins ${kind} ${canonicalize(planned)}`
        : `the worker ran ${kind} ${seen}, not the arm's ${canonicalize(planned)}`;
  }
  const models = config.models.map((m) => m.id.value);
  if (!models.includes(observed.model))
    return `the worker called model '${observed.model}', not the arm's ${models.map((m) => `'${m}'`).join(" or ")}`;
  const routes = config.models.flatMap((m) =>
    m.route === undefined
      ? []
      : [m.route.value.startsWith("sha256:") ? m.route.value : sha256(m.route.value)],
  );
  if (routes.length > 0 && !routes.includes(observed.route))
    return `the worker called route ${observed.route}, which is not the arm's`;
  const parameters = new Map(config.parameters.map((p) => [p.name, canonicalize(p.value)]));
  for (const [name, value] of Object.entries(observed.parameters).toSorted(([a], [b]) =>
    byCodeUnits(a, b),
  )) {
    const planned = parameters.get(name);
    if (planned === undefined)
      return `the worker used parameter '${name}', which the arm's configuration does not hold`;
    if (planned !== canonicalize(value))
      return `the worker used parameter '${name}' = ${canonicalize(value)}, not the arm's ${planned}`;
  }
  return undefined;
}

/** Removes the member at `path` from a JSON value, in place. */
function remove(root: unknown, path: readonly PropertyKey[]): void {
  let node = root;
  for (const key of path.slice(0, -1)) node = (node as Record<PropertyKey, unknown>)[key];
  delete (node as Record<PropertyKey, unknown>)[path.at(-1) as PropertyKey];
}

/**
 * Turns workers' trial results into the run's records: one trial record per result, the measure
 * values that the suite's scorers give each completed trial from its raw output, and the run with
 * its ledger. It does no I/O and never calls a model, so stored outputs can be scored again.
 *
 * Each result must answer a trial the plan lists, with the plan's suite, case, arm and replicate.
 * A failure's class gives the outcome: `infrastructure` an infrastructure failure, `system` a
 * system failure (a failed trial, never a pass), `not_run` a trial not run. A `protocol` failure
 * is a fault of the harness, never of the system: the run records it in `protocolFailures` and is
 * INVALID, and the trial is recorded neither as a failure nor as missing, and never retried. A result
 * with no failure and neither `output` nor `pointer` is a capture failure (`not-captured`): it
 * counts as missing, never as a failure of the system. A result whose observed configuration is not
 * the arm's is an invalid configuration with the reason, and gives no value.
 *
 * Results are read tolerantly: members no record defines are ignored and reported as unused. A
 * value this version does not know (a later failure class), a result of a trial the plan does not
 * list, or a repeated trial throws an ImportError that names the result.
 */
export function importResults(
  plan: SuitePlan,
  results: Iterable<TimedResult>,
  options: {
    /** The runtime that imports the results, recorded in the run. Absent: recorded as unknown. */
    readonly runtime?: Runtime;
  } = {},
): { readonly records: RunRecords; readonly summary: ImportSummary } {
  const { record } = plan;
  const registered = contractFor("ichnaea.trialResult/1");
  if (!registered) throw new Error("ichnaea.trialResult/1 is not a registered contract");
  const contract = { ...registered, schema: TrialResult };
  const planned = new Map(record.trials.map((t) => [t.id as string, t]));
  const arms = new Map(record.arms.map((a) => [a.name as string, a]));
  const cases = new Map(plan.suite.cases.map((c) => [c.id, Case.parse(c)]));
  const unused = new Set<string>();
  const mismatched: string[] = [];
  const protocolFailures: Array<{ readonly trial: string; readonly kind: string }> = [];
  const trials: Trial[] = [];
  let index = 0;
  for (const input of results) {
    index++;
    const where = `result ${index}`;
    const timed = Timed.safeParse(input);
    if (!timed.success)
      throw new ImportError(`${where} is not a timed result:\n${z.prettifyError(timed.error)}`);
    for (const key of Object.keys(timed.data)) if (!TIMED_MEMBERS.has(key)) unused.add(key);
    const read = readRecord(contract, timed.data.result);
    if (!read.ok)
      throw new ImportError(`${where} is not a trial result:\n${z.prettifyError(read.error)}`);
    const [unknown] = read.unknownValues;
    if (unknown)
      throw new ImportError(
        `${where}: result.${unknown.path.join(".")} is ${canonicalize(unknown.value ?? null)}, which this version does not know`,
      );
    // A reader ignores unknown members: drop them, and what is left is a result of this version.
    const raw = structuredClone(timed.data.result);
    for (const path of read.unknownMembers) {
      unused.add(["result", ...path].join("."));
      remove(raw, path);
    }
    const result = TrialResult.parse(raw);
    const { trial: id, failure } = result;
    const p = planned.get(id.id);
    const c = cases.get(id.case);
    const arm = arms.get(id.arm);
    if (!p || !c || !arm) throw new ImportError(`${where}: trial '${id.id}' is not in the plan`);
    if (id.suite !== record.suite)
      throw new ImportError(
        `${where}: trial '${id.id}' belongs to suite '${id.suite}', not '${record.suite}'`,
      );
    if (p.case !== id.case || p.arm !== id.arm || p.replicate !== id.replicate)
      throw new ImportError(
        `${where}: trial '${id.id}' is planned as case '${p.case}', arm '${p.arm}', replicate ${p.replicate}`,
      );
    // The harness failed, not the system: the run records it and is INVALID, and the trial is
    // neither a failure nor a missing trial of the system.
    if (failure?.class === "protocol") {
      protocolFailures.push({ trial: id.id, kind: failure.kind });
      continue;
    }
    const problem = observedProblem(result.observed, arm.configuration);
    if (problem !== undefined) mismatched.push(`'${id.id}': ${problem}`);
    const outcome: Outcome =
      problem !== undefined
        ? "invalid_configuration"
        : failure === undefined
          ? "completed"
          : (OUTCOME_OF[failure.class] ?? "infrastructure_failure");
    const error =
      problem !== undefined
        ? { kind: "configuration-mismatch", message: problem }
        : failure === undefined
          ? undefined
          : {
              kind: failure.kind,
              ...(failure.message === undefined ? {} : { message: failure.message }),
            };
    const trial = Trial.parse({
      schema: "ichnaea.trial/1",
      id: id.id,
      source: "offline",
      run: plan.run,
      case: c.id,
      caseDigest: caseDigest(c),
      unit: c.unit,
      configuration: arm.identity,
      arm: id.arm,
      replicate: id.replicate,
      outcome,
      dataClass: result.dataClass,
      ...(result.output === undefined ? {} : { output: result.output }),
      ...(result.pointer === undefined ? {} : { pointer: result.pointer }),
      ...(error === undefined ? {} : { error }),
      usage: { ...result.usage, calls: result.calls },
      ...(timed.data.startedAt === undefined ? {} : { startedAt: timed.data.startedAt }),
      ...(timed.data.endedAt === undefined ? {} : { endedAt: timed.data.endedAt }),
    });
    trials.push(checkCaptured(trial));
  }

  const problems = recordProblems({ trials, values: [], gates: [] });
  if (problems.length > 0) throw new ImportError(problems.join("; "));

  // Only the measures the plan names are scored, and an invalid configuration gives no value.
  const used = new Set(record.measures.map((m) => m.id as string));
  const measures = [...suiteMeasures(plan.suite).values()].filter((m) => used.has(m.card.id));
  const valid = new Set(
    trials.filter((t) => t.outcome !== "invalid_configuration").map((t) => t.id as string),
  );
  const values: MeasureValue[] = scoreTrials(measures, trials, cases).filter((v) =>
    valid.has(v.trial),
  );

  const recorded = new Map(trials.map((t) => [t.id as string, t.outcome]));
  const starts = trials.flatMap((t) => (t.startedAt === undefined ? [] : [t.startedAt]));
  const ends = trials.flatMap((t) => (t.endedAt === undefined ? [] : [t.endedAt]));
  const startedAt = starts.toSorted((a, b) => Date.parse(a) - Date.parse(b))[0] ?? record.createdAt;
  const completedAt = ends.toSorted((a, b) => Date.parse(b) - Date.parse(a))[0] ?? startedAt;
  const runtime = options.runtime ?? UNKNOWN_RUNTIME;
  const run = Run.parse({
    schema: "ichnaea.run/1",
    id: plan.run,
    plan: digest(record),
    exploratory: false,
    environment: {
      node: runtime.name === "node" ? runtime.version : runtime.name,
      platform: `${runtime.platform}-${runtime.arch}`,
      ichnaea: record.ichnaea,
      ...(runtime === UNKNOWN_RUNTIME ? {} : { arch: runtime.arch, runtime }),
    },
    arms: record.arms,
    lineage: [
      ...record.measures,
      { kind: "package", id: "@hephaestus-build/ichnaea", version: record.ichnaea },
    ],
    ledger: record.trials.map((t) => {
      const outcome = recorded.get(t.id);
      return outcome
        ? { trial: t.id, state: "recorded", outcome }
        : { trial: t.id, state: "planned", outcome: "not_run" };
    }),
    startedAt,
    completedAt,
    ...(protocolFailures.length === 0 ? {} : { protocolFailures }),
  });

  const outcomes: Partial<Record<Outcome, number>> = {};
  for (const t of trials) outcomes[t.outcome] = (outcomes[t.outcome] ?? 0) + 1;
  const warnings: string[] = [];
  const lost = trials.filter((t) => t.error?.kind === NOT_CAPTURED);
  if (lost.length > 0)
    warnings.push(
      `${lost.length} completed result(s) had no captured output, for example '${lost[0]?.id}'; they count as missing trials, never as failures of the system`,
    );
  if (mismatched.length > 0)
    warnings.push(
      `${mismatched.length} result(s) ran another configuration than their arm, so they give no value; for example ${mismatched[0]}`,
    );
  if (protocolFailures.length > 0)
    warnings.push(
      `${protocolFailures.length} result(s) reported a protocol failure, for example '${protocolFailures[0]?.trial}' (${protocolFailures[0]?.kind}); the harness failed, so the run is INVALID`,
    );
  return {
    records: { plan: record, run, trials, values, gates: [] },
    summary: {
      rows: index,
      trials: trials.length,
      values: values.length,
      outcomes,
      notRun: record.trials.length - trials.length - protocolFailures.length,
      warnings,
      unused: [...unused].toSorted(),
    },
  };
}
