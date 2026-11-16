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
  type Plan,
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
import { type SuitePlan, suiteMeasures, suiteRecords } from "./suite.ts";

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

/** A result read and checked against the plan, before its attempts are compared. */
interface Accepted {
  readonly where: string;
  readonly timed: {
    readonly startedAt?: string | undefined;
    readonly endedAt?: string | undefined;
  };
  readonly result: TrialResult;
  readonly c: Case;
  readonly arm: Plan["arms"][number];
}

/** An attempt at a trial that a later attempt replaced, with why it was retried. */
export interface EarlierAttempt {
  /** The trial's ID. */
  readonly trial: string;
  /** The attempt, from 1. */
  readonly attempt: number;
  /** Its failure: an infrastructure failure or a trial not run. */
  readonly failure: { readonly class: "infrastructure" | "not_run"; readonly kind: string };
  /** The calls it made. They count against the per-trial bound and the run's budget. */
  readonly calls: number;
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
   * The planned trials that no result answered: they are recorded as not run.
   */
  readonly notRun: number;
  /**
   * Warnings about the results: completed results that lost their output, results whose observed
   * configuration is not the arm's, with the reason, and protocol failures.
   */
  readonly warnings: readonly string[];
  /** The members some result carried that no record defines, by path, sorted. They are ignored. */
  readonly unused: readonly string[];
  /** The attempts that a later attempt at the same trial replaced, by trial and attempt. */
  readonly earlierAttempts: readonly EarlierAttempt[];
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

/**
 * A completed trial whose output is only behind a pointer was not captured here: a scorer would
 * read no output, so it is an infrastructure failure (`not-captured`), counted as missing. An
 * importer resolves pointers to outputs before import.
 */
function pointerOnly(trial: Trial): Trial {
  if (trial.outcome !== "completed" || trial.output !== undefined || trial.pointer === undefined)
    return trial;
  return {
    ...trial,
    outcome: "infrastructure_failure",
    error: {
      kind: NOT_CAPTURED,
      message: "the output is behind a pointer; resolve it before import",
    },
  };
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
 * is a fault of the harness, never of the system: the trial's outcome is `protocol_failure`,
 * never a failure or a pass, and the run is INVALID. A result
 * with no failure and no `output` is a capture failure (`not-captured`): it counts as missing,
 * never as a failure of the system. That includes a result with only a `pointer`, because a scorer
 * reads the output itself: resolve pointers to outputs before import. A result whose observed configuration is not
 * the arm's is an invalid configuration with the reason, and gives no value. A result that made more
 * calls than the suite's `budget.callsPerTrial` is over budget (`budget_exceeded`): a failed trial,
 * and the run is INVALID.
 *
 * The plan's suite must be the one the plan was made from: a suite whose digest or case set digest
 * differs from the plan's throws, so a result is never scored by another suite's cases or limits.
 *
 * Each trial's attempts are numbered 1 to k with no gap, and the highest counts. Every earlier
 * attempt must be an infrastructure failure or a trial not run, and the trial record keeps them in
 * `attempts` with their calls: an attempt over the per-trial call bound makes the trial over
 * budget, and decide sums every attempt's calls against the run's budget.
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
  // The scorers and limits must be the ones the plan was made from.
  const resolved = suiteRecords(plan.suite);
  if (resolved.caseSet.digest !== record.caseSetDigest)
    throw new ImportError(
      `the suite's case set digest is ${resolved.caseSet.digest}, but the plan was made from ${record.caseSetDigest}; import with the suite the plan was made from`,
    );
  const suiteDigest = digest(resolved.suite);
  if (suiteDigest !== record.suiteDigest)
    throw new ImportError(
      `the suite's digest is ${suiteDigest}, but the plan was made from ${record.suiteDigest}; import with the suite the plan was made from`,
    );
  const registered = contractFor("ichnaea.trialResult/1");
  if (!registered) throw new Error("ichnaea.trialResult/1 is not a registered contract");
  const contract = { ...registered, schema: TrialResult };
  const planned = new Map(record.trials.map((t) => [t.id as string, t]));
  const arms = new Map(record.arms.map((a) => [a.name as string, a]));
  const cases = new Map(plan.suite.cases.map((c) => [c.id, Case.parse(c)]));
  const unused = new Set<string>();
  const mismatched: string[] = [];
  const trials: Trial[] = [];
  const accepted: Accepted[] = [];
  const overCalls: string[] = [];
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
    const id = result.trial;
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
    accepted.push({ where, timed: timed.data, result, c, arm });
  }

  // Retries: the highest attempt of each trial counts. Only an infrastructure failure or a trial
  // not run is retried, so every earlier attempt must be one of those.
  const attempts = new Map<string, Accepted[]>();
  for (const r of accepted) {
    const list = attempts.get(r.result.trial.id) ?? [];
    if (list.some((e) => e.result.trial.attempt === r.result.trial.attempt))
      throw new ImportError(
        `${r.where}: trial '${r.result.trial.id}' attempt ${r.result.trial.attempt} is repeated; give each attempt once`,
      );
    list.push(r);
    attempts.set(r.result.trial.id, list);
  }
  const earlierAttempts: EarlierAttempt[] = [];
  const earlierOf = new Map<string, EarlierAttempt[]>();
  const finals: Accepted[] = [];
  for (const [id, list] of attempts) {
    const sorted = list.toSorted((x, y) => x.result.trial.attempt - y.result.trial.attempt);
    const numbers = sorted.map((e) => e.result.trial.attempt);
    if (numbers.some((n, i) => n !== i + 1))
      throw new ImportError(
        `trial '${id}' has attempts ${numbers.join(", ")}; the attempts of a trial are numbered 1 to k with no gap`,
      );
    for (const [i, e] of sorted.slice(0, -1).entries()) {
      const failure = e.result.failure;
      if (failure?.class !== "infrastructure" && failure?.class !== "not_run")
        throw new ImportError(
          `trial '${id}' attempt ${sorted[i + 1]?.result.trial.attempt} follows ${
            failure === undefined ? "a completed attempt" : `a ${failure.class} failure`
          } at attempt ${e.result.trial.attempt}; only an infrastructure failure or a trial not run is retried`,
        );
      const earlier: EarlierAttempt = {
        trial: id,
        attempt: e.result.trial.attempt,
        failure: { class: failure.class, kind: failure.kind },
        calls: e.result.calls,
      };
      earlierAttempts.push(earlier);
      earlierOf.set(id, [...(earlierOf.get(id) ?? []), earlier]);
    }
    finals.push(sorted.at(-1) as Accepted);
  }

  for (const { timed, result, c, arm } of finals) {
    const { trial: id, failure } = result;
    // The harness failed, not the system: nothing else about the trial is judged.
    const protocol = failure?.class === "protocol";
    const problem = protocol ? undefined : observedProblem(result.observed, arm.configuration);
    if (problem !== undefined) mismatched.push(`'${id.id}': ${problem}`);
    // The per-trial call bound holds for every attempt, whatever the trial's outcome: a trial with
    // any attempt over it is over budget, so a retry cannot hide an overrun.
    const bound = plan.suite.budget.callsPerTrial;
    const earlier = earlierOf.get(id.id) ?? [];
    const overEarlier = earlier.find((e) => e.calls > bound);
    const overBound =
      protocol || problem !== undefined
        ? undefined
        : overEarlier !== undefined
          ? `attempt ${overEarlier.attempt} made ${overEarlier.calls} calls, over the bound of ${bound} per trial`
          : result.calls > bound
            ? `the trial made ${result.calls} calls, over the bound of ${bound} per trial`
            : undefined;
    if (overBound !== undefined) overCalls.push(id.id);
    const outcome: Outcome = protocol
      ? "protocol_failure"
      : problem !== undefined
        ? "invalid_configuration"
        : overBound !== undefined
          ? "budget_exceeded"
          : failure === undefined
            ? "completed"
            : (OUTCOME_OF[failure.class] ?? "infrastructure_failure");
    const error =
      problem !== undefined
        ? { kind: "configuration-mismatch", message: problem }
        : overBound !== undefined
          ? { kind: "over-call-bound", message: overBound }
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
      ...(earlier.length === 0
        ? {}
        : {
            attempts: earlier.map((e) => ({
              attempt: e.attempt,
              failure: e.failure,
              calls: e.calls,
            })),
          }),
      ...(timed.startedAt === undefined ? {} : { startedAt: timed.startedAt }),
      ...(timed.endedAt === undefined ? {} : { endedAt: timed.endedAt }),
    });
    trials.push(checkCaptured(pointerOnly(trial)));
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
      node: runtime.version,
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
  });

  const outcomes: Partial<Record<Outcome, number>> = {};
  for (const t of trials) outcomes[t.outcome] = (outcomes[t.outcome] ?? 0) + 1;
  const warnings: string[] = [];
  const lost = trials.filter((t) => t.error?.kind === NOT_CAPTURED && t.pointer === undefined);
  const pointed = trials.filter((t) => t.error?.kind === NOT_CAPTURED && t.pointer !== undefined);
  if (pointed.length > 0)
    warnings.push(
      `${pointed.length} completed result(s) carry only a pointer to their output, for example '${pointed[0]?.id}'; resolve pointers to outputs before import, because a pointer is never scored, so they count as missing trials`,
    );
  if (lost.length > 0)
    warnings.push(
      `${lost.length} completed result(s) had no captured output, for example '${lost[0]?.id}'; they count as missing trials, never as failures of the system`,
    );
  if (mismatched.length > 0)
    warnings.push(
      `${mismatched.length} result(s) ran another configuration than their arm, so they give no value; for example ${mismatched[0]}`,
    );
  if (overCalls.length > 0)
    warnings.push(
      `${overCalls.length} result(s) made more calls than the bound of ${plan.suite.budget.callsPerTrial} per trial, for example '${overCalls[0]}'; they count as over budget, so the run is INVALID`,
    );
  const protocolFailures = trials.filter((t) => t.outcome === "protocol_failure");
  if (protocolFailures.length > 0)
    warnings.push(
      `${protocolFailures.length} result(s) reported a protocol failure, for example '${protocolFailures[0]?.id}' (${protocolFailures[0]?.error?.kind}); the harness failed, so the run is INVALID`,
    );
  return {
    records: { plan: record, run, trials, values, gates: [] },
    summary: {
      rows: index,
      trials: trials.length,
      values: values.length,
      outcomes,
      notRun: record.trials.length - trials.length,
      warnings,
      unused: [...unused].toSorted(),
      earlierAttempts: earlierAttempts.toSorted(
        (x, y) => byCodeUnits(x.trial, y.trial) || x.attempt - y.attempt,
      ),
    },
  };
}
