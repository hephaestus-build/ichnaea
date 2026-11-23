import { createHash } from "node:crypto";
import type * as z from "zod";
import {
  appendFile,
  mkdir,
  readFile,
  realpath,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { canonicalize, digest } from "../contracts/canonical.ts";
import { classRank } from "../contracts/data-class.ts";
import { caseDigest, caseSetDigest, verifyArms } from "../contracts/identity.ts";
import { Digest, Duration, PlanDigest, RunId } from "../contracts/primitives.ts";
import { readRecord } from "../contracts/reader.ts";
import { contractFor } from "../contracts/registry.ts";
import { type Case, type CaseSet } from "../contracts/records/case.ts";
import { type Plan } from "../contracts/records/plan.ts";
import { Trial } from "../contracts/records/trial.ts";
import {
  FAILURE_OUTCOME,
  TrialIdentity,
  TrialRequest,
  TrialResult,
  WorkerError,
  WorkerEvent,
  WorkerReady,
} from "../contracts/records/worker.ts";

import type { Host } from "./host.ts";
import { NOT_CAPTURED, recordRun } from "./import.ts";
import { CallLedger } from "./ledger.ts";
import { FileStore } from "./store.ts";
import { WorkerTransport } from "./worker-transport.ts";

type Planned = Plan["trials"][number];
type Arm = Plan["arms"][number];
type Attempt = NonNullable<Trial["attempts"]>[number];

interface Job {
  readonly trial: Planned;
  readonly case: Case;
  readonly arm: Arm;
  readonly directory: string;
  readonly attempts: Attempt[];
}

interface Active {
  readonly job: Job;
  readonly request: TrialRequest;
  readonly startedAt: string;
  readonly sent: number;
  readonly deadlineMs: number;
  throttleMs: number;
  orderedAt?: number;
  calls?: number;
  cancelled?: { readonly reason: Cancellation; readonly until: number };
}

/** A command worker and the already resolved inputs to its run. */
export interface RunWorkerInput {
  /** The loaded measures and gates that score the results. */
  readonly host: Host;
  /** The directory of the record store and monthly call ledger. */
  readonly store: string;
  /** The ID of the new run. */
  readonly run: string;
  /** The locked plan; its trial order is the dispatch order. */
  readonly plan: Plan;
  /** The manifest pinned in the plan. */
  readonly caseSet: CaseSet;
  /** The cases that the planned trials use. */
  readonly cases: readonly Case[];
  /** An executable and its arguments. No shell interprets them. */
  readonly command: readonly [string, ...string[]];
  /** Monthly calls allowed for the plan's endpoint. */
  readonly monthlyCap: number;
  /** One trial attempt's deadline in ISO seconds, for example PT30S. */
  readonly deadline: string;
  /** Number of total attempts, including the first one. Defaults to two. */
  readonly maxAttempts?: number;
  /** Stops issuing requests and cancels work in flight when aborted. */
  readonly signal?: AbortSignal;
  /** Ichnaea's version for the run's lineage. */
  readonly ichnaea: string;
}

/** Evidence stored by the runner and whether an error stopped the run. */
export interface RunWorkerResult {
  /** Number of trial records created. */
  readonly trials: number;
  /** Number of values produced by the configured scorers. */
  readonly values: number;
  /** A local transport error, if one stopped execution. */
  readonly workerError?: string;
  /** Whether an operator cancelled the run. */
  readonly interrupted: boolean;
}

type Cancellation =
  | "timeout"
  | "interrupted"
  | "ordered-result-delay"
  | "throttled-wall-limit"
  | "late-throttle-report";

const CANCEL_GRACE = 1000;
const ORDER_GRACE = 100;

function netDeadline(active: Active): number {
  return active.sent + Math.min(active.deadlineMs * 3, active.deadlineMs + active.throttleMs);
}

function replyDeadline(active: Active): number {
  return Math.max(netDeadline(active), (active.orderedAt ?? -Infinity) + ORDER_GRACE);
}

function expiration(active: Active): Cancellation {
  if (replyDeadline(active) > netDeadline(active)) return "ordered-result-delay";
  if (active.throttleMs >= active.deadlineMs * 2) return "throttled-wall-limit";
  return "timeout";
}

function trackThrottle(active: Active, wait: number | undefined, received: number): void {
  if (wait === undefined) return;
  if (wait < active.throttleMs || wait > received - active.sent + 5)
    throw new ProtocolError(`${nameOf(active)} reported invalid throttle time`);
  active.throttleMs = wait;
}

/** Reports only safe identifiers and descriptions of protocol violations. */
class ProtocolError extends Error {}

function decode(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    throw new ProtocolError("worker stdout contained a line that is not JSON");
  }
}

function compatible<T>(id: string, schema: z.ZodType<T>, value: unknown): T | undefined {
  const strict = schema.safeParse(value);
  if (strict.success) return strict.data;
  const contract = contractFor(id);
  if (!contract) return undefined;
  const parsed = readRecord({ ...contract, schema }, value);
  if (!parsed.ok || parsed.unknownValues.length) return undefined;
  const cleaned: unknown = structuredClone(value);
  for (const path of parsed.unknownMembers) {
    let node = cleaned;
    for (const key of path.slice(0, -1)) {
      node =
        node && typeof node === "object" && Object.hasOwn(node, key)
          ? (node as Record<PropertyKey, unknown>)[key]
          : undefined;
    }
    const last = path.at(-1);
    if (node && typeof node === "object" && last !== undefined)
      delete (node as Record<PropertyKey, unknown>)[last];
  }
  return schema.safeParse(cleaned).data;
}

function nameOf(active: Active): string {
  return `trial '${active.job.trial.id}' attempt ${active.request.trial.attempt}`;
}

function verifyPlan(input: RunWorkerInput): {
  endpoint: string;
  calls: number;
  cases: Map<string, Case>;
} {
  const { plan, caseSet, host } = input;
  const endpoint = plan.schedule?.endpoint;
  if (!endpoint || !Number.isSafeInteger(input.monthlyCap) || input.monthlyCap < 0)
    throw new Error("a worker run needs a plan endpoint and a non-negative monthly call cap");
  const calls = plan.budget.callsPerTrial;
  if (
    !calls ||
    !plan.trials.length ||
    plan.arms.some((arm) => !arm.runs) ||
    plan.trials.length * calls !== plan.budget.worstCaseCalls ||
    plan.budget.worstCaseCalls > plan.budget.maxCalls ||
    plan.budget.worstCaseCalls > (plan.budget.monthlyRemaining ?? Infinity)
  )
    throw new Error(
      "the plan must book its worst-case calls for every trial and stay within its call cap",
    );
  if (
    new Set(plan.trials.map((trial) => trial.id)).size !== plan.trials.length ||
    new Set(plan.arms.map((arm) => arm.name)).size !== plan.arms.length ||
    verifyArms(plan.arms).length
  )
    throw new Error(
      "the plan has duplicate identities or an arm with an invalid configuration digest",
    );
  if (
    caseSet.id !== plan.caseSet ||
    caseSet.digest !== plan.caseSetDigest ||
    caseSetDigest(caseSet.cases) !== caseSet.digest
  )
    throw new Error("the case set does not match the plan's digest");
  if (plan.arms.some((arm) => arm.configuration.models.length !== 1))
    throw new Error("the command worker protocol needs exactly one model per arm");
  const entries = new Map(caseSet.cases.map((entry) => [entry.id, entry]));
  const cases = new Map(input.cases.map((item) => [item.id as string, item]));
  if (cases.size !== input.cases.length || entries.size !== caseSet.cases.length)
    throw new Error("the case inputs or case set repeat a case");
  for (const item of input.cases) {
    const entry = entries.get(item.id);
    if (
      entry?.digest !== caseDigest(item) ||
      entry.pool !== item.pool ||
      entry.family !== item.family
    )
      throw new Error(`case '${item.id}' does not match its manifest entry`);
  }
  const arms = new Set(plan.arms.map((arm) => arm.name));
  for (const trial of plan.trials) {
    if (!arms.has(trial.arm) || !cases.has(trial.case))
      throw new Error(`trial '${trial.id}' has an unknown arm or case`);
  }
  for (const measure of plan.measures) {
    const card = host.measures.get(measure.id)?.card;
    if (!card || digest(card) !== measure.digest)
      throw new Error(`measure '${measure.id}' does not match the locked plan`);
  }
  for (const gate of plan.hardGates)
    if (!host.gates.get(gate)?.check) throw new Error(`gate '${gate}' has no local check`);
  return { endpoint, calls, cases };
}

function observedMismatch(
  result: TrialResult,
  request: TrialRequest,
  arm: Arm,
): string | undefined {
  const actual = result.observed;
  const expected = arm.configuration;
  if (actual.configuration !== digest(expected)) return "configuration file digest differs";
  const model = expected.models[0];
  if (expected.models.length !== 1 || actual.model !== model?.id.value)
    return "the observed model differs from the arm's model";
  if (
    model.route &&
    actual.route !== model.route.value &&
    actual.route !== digest(model.route.value)
  )
    return "the observed endpoint route differs";
  const parameters = Object.fromEntries(expected.parameters.map((p) => [p.name, p.value]));
  if (canonicalize(actual.parameters) !== canonicalize(parameters))
    return "the observed generation parameters differ";
  if (
    expected.factors["code.commit"] &&
    expected.factors["code.commit"].value !== actual.code.commit
  )
    return "the observed commit differs";
  if (expected.factors["code.image"] && expected.factors["code.image"].value !== actual.code.image)
    return "the observed image differs";
  for (const [name, factor] of Object.entries(expected.factors)) {
    if (factor.part === "data" && actual.environment[name] !== factor.value)
      return "an observed environment factor differs";
  }
  if (classRank(result.dataClass) < classRank(request.dataClass))
    return "the worker lowered the data class";
  return undefined;
}

async function artifactDigest(path: string): Promise<string> {
  const info = await stat(path);
  if (info.isDirectory()) {
    const entries = [];
    for (const name of (await readdir(path)).toSorted()) {
      const child = join(path, name);
      if ((await realpath(child)) !== child)
        throw new ProtocolError("artifact contains a symbolic link");
      entries.push([name, await artifactDigest(child)]);
    }
    return digest(entries);
  }
  if (!info.isFile() || info.size > 8 * 1024 * 1024)
    throw new ProtocolError("artifact is not a regular file within the size limit");
  return `sha256:${createHash("sha256")
    .update(await readFile(path))
    .digest("hex")}`;
}

async function evidence(result: TrialResult, workdir: string): Promise<Trial["evidence"]> {
  if (!result.artifacts?.length) return undefined;
  const root = await realpath(workdir);
  const found: NonNullable<Trial["evidence"]> = [];
  const names = new Set<string>();
  for (const artifact of result.artifacts) {
    if (names.has(artifact.name)) throw new ProtocolError("worker repeated an artifact name");
    names.add(artifact.name);
    const path = await realpath(resolve(root, artifact.path));
    const suffix = relative(root, path);
    if (
      suffix === "" ||
      suffix === ".." ||
      suffix.startsWith("../") ||
      suffix.startsWith("..\\") ||
      isAbsolute(suffix)
    )
      throw new ProtocolError("worker named an artifact outside its trial directory");
    found.push({ name: artifact.name, digest: Digest.parse(await artifactDigest(path)) });
  }
  return found;
}

function makeTrial(
  active: Active,
  run: RunId,
  overrides: Pick<Trial, "outcome"> & Partial<Trial>,
): Trial {
  const { trial, case: item, arm, attempts } = active.job;
  return Trial.parse({
    schema: "ichnaea.trial/1",
    id: trial.id,
    source: "offline",
    run,
    case: item.id,
    caseDigest: active.request.case.digest,
    unit: item.unit,
    configuration: arm.identity,
    arm: trial.arm,
    replicate: trial.replicate,
    dataClass: item.dataClass,
    startedAt: active.startedAt,
    endedAt: new Date().toISOString(),
    ...(attempts.length ? { attempts } : {}),
    ...overrides,
  });
}

async function completed(active: Active, result: TrialResult, run: RunId): Promise<Trial> {
  const { request, job } = active;
  const failures = result.failure;
  const usage = {
    calls: result.usage.calls,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    wallMs: Math.max(0, Date.now() - Date.parse(active.startedAt)),
  };

  if (
    failures &&
    (result.output !== undefined || result.truncated !== undefined || result.pointer !== undefined)
  )
    throw new ProtocolError(`${nameOf(active)} sent both failure and captured output`);
  if (classRank(result.dataClass) < classRank(request.dataClass))
    throw new ProtocolError(`${nameOf(active)} lowered the data class`);
  const common = { usage, dataClass: result.dataClass };
  if (failures?.class === "protocol")
    return makeTrial(active, run, {
      ...common,
      outcome: "protocol_failure",
      error: { kind: failures.kind },
    });
  if (usage.calls > (request.limits.calls ?? 0))
    return makeTrial(active, run, {
      ...common,
      outcome: "budget_exceeded",
      error: { kind: "trial-call-cap" },
    });
  if (active.calls !== undefined && usage.calls < active.calls)
    throw new ProtocolError(`${nameOf(active)} reported fewer calls than its heartbeat`);
  if (active.cancelled) return cancelledTrial(active, run, usage.calls);
  if (failures?.class === "infrastructure" || failures?.class === "not_run")
    return makeTrial(active, run, {
      ...common,
      outcome: FAILURE_OUTCOME[failures.class],
      error: { kind: failures.kind },
    });
  const mismatch = observedMismatch(result, request, job.arm);
  if (mismatch)
    return makeTrial(active, run, {
      ...common,
      outcome: "invalid_configuration",
      error: { kind: "configuration-mismatch", message: mismatch },
    });
  if (failures)
    return makeTrial(active, run, {
      ...common,
      outcome: FAILURE_OUTCOME[failures.class],
      error: { kind: failures.kind },
    });
  if (
    result.truncated ||
    (result.output === undefined && result.pointer === undefined && !result.artifacts?.length)
  )
    return makeTrial(active, run, {
      ...common,
      outcome: "infrastructure_failure",
      error: { kind: NOT_CAPTURED },
    });
  return makeTrial(active, run, {
    ...common,
    outcome: "completed",
    output: result.output,
    pointer: result.pointer,
    evidence: await evidence(result, request.workdir),
  });
}

function cancelledTrial(
  active: Active,
  run: RunId,
  calls = active.calls ?? active.request.limits.calls ?? 0,
): Trial {
  const reason = active.cancelled?.reason ?? "interrupted";
  const outcome =
    reason === "timeout"
      ? "system_failure"
      : reason === "interrupted"
        ? "not_run"
        : "infrastructure_failure";
  return makeTrial(active, run, {
    outcome,
    usage: { calls },
    error: { kind: reason === "interrupted" ? "operator-cancelled" : reason },
  });
}

function retryable(trial: Trial, maxAttempts: number, active: Active, truncated: boolean): boolean {
  return (
    active.request.trial.attempt < maxAttempts &&
    (trial.usage?.calls ?? 0) < (active.request.limits.calls ?? 0) &&
    (trial.outcome === "infrastructure_failure" || trial.outcome === "not_run") &&
    !truncated
  );
}

async function requestFor(
  job: Job,
  plan: Plan,
  planDigest: PlanDigest,
  deadline: string,
  calls: number,
  workdir: string,
): Promise<TrialRequest> {
  const attempt = job.attempts.length + 1;
  const dir = join(workdir, "attempts", encodeURIComponent(job.trial.id), String(attempt));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return TrialRequest.parse({
    schema: "ichnaea.trialRequest/1",
    dataClass: job.case.dataClass,
    plan: planDigest,
    trial: {
      id: job.trial.id,
      suite: plan.suite,
      case: job.trial.case,
      arm: job.trial.arm,
      replicate: job.trial.replicate,
      attempt,
    },
    case: {
      id: job.case.id,
      digest: caseDigest(job.case),
      unit: job.case.unit,
      input: job.case.input,
      turns: job.case.turns,
      fixtures: job.case.fixtures,
    },
    limits: { calls: calls - job.attempts.reduce((sum, past) => sum + past.calls, 0) },
    deadline,
    workdir: dir,
    configuration: { path: job.directory },
    seed: plan.seed,
  });
}

function requireLine(frame: Awaited<ReturnType<WorkerTransport["next"]>>): string {
  if ("line" in frame) return frame.line;
  if ("ended" in frame) throw new ProtocolError(frame.reason);
  throw new ProtocolError("worker did not become ready before the deadline");
}

function sameTrial(a: TrialRequest["trial"], b: TrialRequest["trial"]): boolean {
  return canonicalize(a) === canonicalize(b);
}

interface Evidence {
  trials: Trial[];
  results: TrialResult[];
  workerError?: string;
}

async function execute(
  input: RunWorkerInput,
  jobs: Job[],
  limits: { calls: number; deadlineMs: number; maxAttempts: number; workdir: string },
  run: RunId,
): Promise<Evidence> {
  const {
    plan,
    command: [file, ...args],
    signal,
  } = input;
  const { calls, deadlineMs, maxAttempts, workdir } = limits;
  const planDigest = PlanDigest.parse(digest(plan));
  const active: Active[] = [];
  const retries: { job: Job; previous: Trial }[] = [];
  const trials: Trial[] = [];
  const results: TrialResult[] = [];
  let index = 0;
  let transport: WorkerTransport | undefined;
  let capacity = 1;
  let workerError: string | undefined;
  const settle = (current: Active, trial: Trial, truncated = false): void => {
    if (!signal?.aborted && retryable(trial, maxAttempts, current, truncated)) {
      current.job.attempts.push({
        attempt: current.request.trial.attempt,
        failure: {
          class: trial.outcome === "not_run" ? "not_run" : "infrastructure",
          kind: trial.error?.kind ?? "worker-stopped",
        },
        calls: trial.usage?.calls ?? 0,
      });
      retries.push({ job: current.job, previous: trial });
    } else trials.push(trial);
  };
  const recover = (reason: string): void => {
    for (const current of active.splice(0)) {
      settle(
        current,
        current.cancelled
          ? cancelledTrial(current, run)
          : makeTrial(current, run, {
              outcome: "infrastructure_failure",
              error: { kind: reason },
              usage: { calls: current.calls ?? current.request.limits.calls ?? 0 },
            }),
      );
    }
  };

  try {
    while (index < jobs.length || retries.length || active.length) {
      if (active.length === 0 && signal?.aborted) break;
      if (!transport) {
        transport = new WorkerTransport(file, args);
        const frame = await transport.next(Math.max(1000, deadlineMs), signal);
        if ("interrupted" in frame) break;
        const ready = compatible("ichnaea.workerReady/1", WorkerReady, decode(requireLine(frame)));
        if (ready?.protocol !== "ichnaea.trialRequest/1")
          throw new ProtocolError("worker did not advertise the trial request protocol");
        capacity = Math.min(ready.capacity, plan.schedule?.concurrency ?? 1, 1024);
      }

      while (active.length < capacity && (retries.length || index < jobs.length)) {
        if (signal?.aborted) break;
        const retry = retries[0];
        const job = retry?.job ?? jobs[index];
        if (!job) break;
        const request = await requestFor(job, plan, planDigest, input.deadline, calls, workdir);
        if (signal?.aborted) break;
        if (retry) retries.shift();
        else index++;
        active.push({
          job,
          request,
          sent: performance.now(),
          deadlineMs,
          throttleMs: 0,
          startedAt: new Date().toISOString(),
        });
        transport.send(request);
      }
      if (!active.length) break;

      const first = active[0] as Active;
      if (signal?.aborted) {
        const until = performance.now() + CANCEL_GRACE;
        for (const current of active) {
          if (current.cancelled) continue;
          current.cancelled = { reason: "interrupted", until };
          transport.send({ schema: "ichnaea.cancel/1", trial: current.request.trial });
        }
      }

      // Only the first result can be late. The worker may have already finished later trials
      // whose results it cannot send until the first result has been delivered.
      const until = first.cancelled?.until ?? replyDeadline(first);
      const frame = await transport.next(
        until - performance.now(),
        signal?.aborted ? undefined : signal,
      );
      if ("interrupted" in frame) continue;
      if ("timeout" in frame) {
        if (!first.cancelled) {
          first.cancelled = { reason: expiration(first), until: performance.now() + CANCEL_GRACE };
          transport.send({ schema: "ichnaea.cancel/1", trial: first.request.trial });
          continue;
        }
        await transport.close();
        transport = undefined;
        recover("worker-restarted");
        continue;
      }
      if ("ended" in frame) {
        if (frame.reason !== "worker closed stdout" && frame.reason !== "worker closed stdin")
          throw new ProtocolError(`${nameOf(first)}: ${frame.reason}`);
        await transport.close();
        transport = undefined;
        recover("worker-exited");
        continue;
      }
      const message = decode(frame.line);
      if (message === null || typeof message !== "object" || !("schema" in message))
        throw new ProtocolError(`${nameOf(first)}: worker line has no schema`);
      if (message.schema === "ichnaea.workerError/1") {
        const failure = compatible(message.schema, WorkerError, message);
        throw new ProtocolError(
          `${nameOf(first)}: worker reported '${failure?.kind ?? "invalid protocol error"}'`,
        );
      }
      if (message.schema === "ichnaea.workerEvent/1") {
        const event = compatible(message.schema, WorkerEvent, message);
        if (!event) {
          const identity = TrialIdentity.safeParse("trial" in message ? message.trial : undefined);
          const contract = contractFor(message.schema);
          if (
            identity.success &&
            contract &&
            active.some((a) => sameTrial(a.request.trial, identity.data)) &&
            "kind" in message &&
            message.kind !== "heartbeat" &&
            message.kind !== "tool_call" &&
            readRecord(contract, message).ok
          )
            continue;
          throw new ProtocolError(`${nameOf(first)}: invalid worker event`);
        }
        const current = active.find((a) => sameTrial(a.request.trial, event.trial));
        if (!current)
          throw new ProtocolError(
            `${nameOf(first)}: event for a trial or attempt that is not in flight`,
          );
        if (event.kind === "heartbeat") {
          const used = event.calls;
          if (used < (current.calls ?? 0) || used > (current.request.limits.calls ?? 0))
            throw new ProtocolError(`${nameOf(current)} reported invalid heartbeat calls`);
          current.calls = used;
          trackThrottle(current, event.throttled?.ms, frame.received);
        }
        continue;
      }
      const result = compatible("ichnaea.trialResult/1", TrialResult, message);
      if (!result) throw new ProtocolError(`${nameOf(first)}: invalid worker result`);
      const matched = active.find((current) => sameTrial(current.request.trial, result.trial));
      let accepted = result;
      if (matched && classRank(result.dataClass) >= classRank(matched.request.dataClass)) {
        const dataClass = (result.artifacts ?? []).reduce(
          (current, artifact) =>
            artifact.class && classRank(artifact.class) > classRank(current)
              ? artifact.class
              : current,
          result.dataClass,
        );
        accepted = { ...result, dataClass };
        await appendFile(join(workdir, ".received.jsonl"), `${canonicalize(accepted)}\n`, {
          mode: 0o600,
        });
        results.push(accepted);
      }
      if (matched !== first)
        throw new ProtocolError(
          `out-of-order result for trial '${result.trial.id}' attempt ${result.trial.attempt}; expected ${nameOf(first)}`,
        );
      if (classRank(result.dataClass) < classRank(first.request.dataClass))
        throw new ProtocolError(`${nameOf(first)} lowered the data class`);
      trackThrottle(first, result.usage.throttled?.ms, frame.received);
      if (!first.cancelled && frame.received >= replyDeadline(first))
        first.cancelled = { reason: expiration(first), until: frame.received };
      if (first.cancelled?.reason === "timeout" && frame.received < replyDeadline(first)) {
        if (result.failure)
          first.cancelled = { reason: "late-throttle-report", until: frame.received };
        else delete first.cancelled;
      }
      const trial = await completed(first, accepted, run);
      active.shift();
      const next = active[0];
      if (next) next.orderedAt = frame.received;
      settle(first, trial, result.truncated === true);
      if (trial.outcome === "protocol_failure")
        throw new ProtocolError(`${nameOf(first)}: worker reported a protocol failure`);
    }
  } catch (error) {
    workerError =
      error instanceof ProtocolError ? error.message : "worker transport could not finish";
    for (const current of active) {
      trials.push(
        makeTrial(current, run, {
          outcome: "protocol_failure",
          error: { kind: "worker-transport" },
          usage: { calls: current.calls ?? current.request.limits.calls ?? 0 },
        }),
      );
    }
  } finally {
    await transport?.close();
  }
  trials.push(...retries.map((retry) => retry.previous));
  return { trials, results, ...(workerError ? { workerError } : {}) };
}

/** Executes a locked plan locally and records the evidence with the usual run and trial records. */
export async function runCommandWorker(input: RunWorkerInput): Promise<RunWorkerResult> {
  const run = RunId.parse(input.run);
  const { endpoint, calls, cases } = verifyPlan(input);
  const deadline = Duration.parse(input.deadline);
  const deadlineMs = Number(deadline.slice(2, -1)) * 1000;
  const maxAttempts = input.maxAttempts ?? 2;
  if (
    !Number.isFinite(deadlineMs) ||
    deadlineMs < 1 ||
    deadlineMs * 3 > 2 ** 31 - 1 ||
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1
  )
    throw new Error("a worker needs a valid deadline and a positive attempt limit");
  if (input.signal?.aborted) return { trials: 0, values: 0, interrupted: true };

  const store = new FileStore(input.store);
  if ((await store.runs()).includes(input.run)) throw new Error(`run '${run}' already exists`);
  const startedAt = new Date().toISOString();
  const root = resolve(input.store, "worker");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const workdir = join(root, encodeURIComponent(run));
  await mkdir(workdir, { mode: 0o700 });
  try {
    await new CallLedger(input.store).reserve(endpoint, input.monthlyCap, {
      run,
      at: startedAt,
      calls: input.plan.budget.worstCaseCalls,
    });
  } catch (error) {
    await rm(workdir, { recursive: true, force: true });
    throw error;
  }
  const arms = new Map(input.plan.arms.map((arm) => [arm.name, arm]));
  const directories = new Map<Arm["name"], string>();
  for (const arm of input.plan.arms) {
    const path = join(workdir, `arm-${encodeURIComponent(arm.name)}.json`);
    await writeFile(path, canonicalize(arm.configuration), { flag: "wx", mode: 0o400 });
    directories.set(arm.name, path);
  }
  const jobs = input.plan.trials.map((trial): Job => ({
    trial,
    case: cases.get(trial.case)!,
    arm: arms.get(trial.arm)!,
    directory: directories.get(trial.arm)!,
    attempts: [],
  }));
  const executed = await execute(input, jobs, { calls, deadlineMs, maxAttempts, workdir }, run);
  const recorded = await recordRun({
    host: input.host,
    store,
    plan: input.plan,
    cases: input.cases,
    result: { trials: executed.trials, values: [] },
    id: run,
    startedAt,
    completedAt: new Date().toISOString(),
    ichnaea: input.ichnaea,
    workerResults: executed.results,
    ...(executed.workerError ? { workerError: executed.workerError } : {}),
  });
  await rm(join(workdir, ".received.jsonl"), { force: true });
  return {
    trials: recorded.trials,
    values: recorded.values,
    interrupted: input.signal?.aborted === true,
    ...(executed.workerError ? { workerError: executed.workerError } : {}),
  };
}
