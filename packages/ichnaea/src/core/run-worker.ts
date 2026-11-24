import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { classRank } from "../contracts/data-class.ts";
import { canonicalize, digest, sha256 } from "../contracts/canonical.ts";
import { caseDigest } from "../contracts/identity.ts";
import type { Case } from "../contracts/records/case.ts";
import type { Plan } from "../contracts/records/plan.ts";
import type { Run } from "../contracts/records/run.ts";
import { Trial } from "../contracts/records/trial.ts";
import { TrialRequest, TrialResult, WorkerEvent } from "../contracts/records/worker.ts";
import { type Attempt, BlockRunner } from "../run/blocks.ts";

import { publishRecord } from "./publish-record.ts";
import { NOT_CAPTURED } from "./record-run.ts";
import { workerEvidence } from "./runner-evidence.ts";
import type { RunWork } from "./runner-work.ts";
import { captureArtifacts } from "./worker-artifacts.ts";
import { readWorkerRecord } from "./worker-record.ts";
import { CommandWorker } from "./worker-transport.ts";

const CANCEL_MS = 500;

type Prepared = { readonly cases: readonly Case[]; readonly plan: Plan };
type Block = NonNullable<ReturnType<BlockRunner["startBlock"]>>;
type Settled = ReturnType<BlockRunner["accept"]>;
type Flight = {
  attempt: Attempt;
  request: TrialRequest;
  startedAt: string;
  settings: string;
  arm: Plan["arms"][number];
  cancel?: { deadline: number; settlement: Settled };
};

export async function runWorkerBlock(input: {
  work: RunWork;
  worker: CommandWorker;
  runner: BlockRunner;
  run: string;
  block: Block;
  prepared: Prepared;
  signal: AbortSignal;
  deadlineMs: number;
}): Promise<"complete" | NonNullable<NonNullable<Run["execution"]>["failure"]>> {
  const { work, worker, runner, block, prepared, signal, deadlineMs } = input;
  const directory = join(work.directory, "worker", String(block.block));
  await mkdir(directory, { recursive: true });
  const cases = new Map(prepared.cases.map((entry) => [entry.id, entry]));
  const arms = new Map(prepared.plan.arms.map((entry) => [entry.name, entry]));
  const analysisPlan = digest(prepared.plan.analysis);
  const settingsFiles = new Map<string, { path: string; settings: string }>();
  for (const arm of prepared.plan.arms) {
    const file = `${arm.name}.json`;
    await publishRecord(directory, file, arm.configuration);
    const settings = sha256(`${canonicalize(arm.configuration)}\n`);
    settingsFiles.set(arm.name, { path: join(directory, file), settings });
  }

  let timedOut = false;
  const flights = new Map<string, Flight>();
  const replaced = new Map<string, NonNullable<Trial["attempts"]>>();
  async function settle(
    flight: Flight,
    settlement: Settled,
    result: TrialResult,
    artifacts?: Trial["evidence"],
  ): Promise<"protocol" | undefined> {
    const { request, attempt } = flight;
    flights.delete(request.trial.id);
    const previous = replaced.get(request.trial.id) ?? [];
    const { disposition, calls } = settlement;
    if (disposition === "retry") {
      const failure = result.failure;
      previous.push({
        attempt: request.trial.attempt,
        calls,
        failure: {
          class: failure?.class === "not_run" ? "not_run" : "infrastructure",
          kind: failure?.kind ?? NOT_CAPTURED,
        },
      });
      replaced.set(request.trial.id, previous);
      await work.outcome(request.trial, { disposition, calls });
      return;
    }
    const trial = workerEvidence(request, result, {
      run: input.run,
      block: block.block,
      analysisPlan,
      configuration: flight.arm.identity,
      settings: flight.settings,
      artifacts,
      expected: flight.arm.configuration,
      ...(attempt.first === undefined ? {} : { first: attempt.first }),
      startedAt: flight.startedAt,
      endedAt: new Date().toISOString(),
      ...(previous.length === 0 ? {} : { attempts: previous }),
    });
    await work.outcome(request.trial, {
      disposition: trial.outcome === "protocol_failure" ? "protocol" : disposition,
      calls: Math.max(calls, result.usage.calls),
      trial: JSON.parse(canonicalize(trial)),
    });
    return trial.outcome === "protocol_failure" ? "protocol" : undefined;
  }

  while (true) {
    signal.throwIfAborted();
    let attempt: Attempt | undefined;
    while (
      flights.size < worker.ready.capacity &&
      (attempt = runner.dispatch(performance.now(), worker.ready.capacity))
    ) {
      const trialCase = cases.get(attempt.trial.case);
      const arm = arms.get(attempt.trial.arm);
      const file = settingsFiles.get(attempt.trial.arm);
      if (!trialCase || !arm || !file) throw new Error("attempt does not match the bound plan");
      const workdir = join(directory, digest(attempt.trial).slice(7));
      await mkdir(workdir);
      const { id, unit, input: caseInput, turns, fixtures, dataClass } = trialCase;
      const request = TrialRequest.parse({
        schema: "ichnaea.trialRequest/1",
        dataClass,
        plan: analysisPlan,
        trial: attempt.trial,
        case: { id, digest: caseDigest(trialCase), unit, input: caseInput, turns, fixtures },
        workdir,
        deadline: `PT${deadlineMs / 1000}S`,
        configuration: { path: file.path },
        limits: { calls: attempt.calls },
      });
      await work.intent(request.trial);
      signal.throwIfAborted();
      flights.set(request.trial.id, {
        request,
        arm,
        attempt,
        startedAt: new Date().toISOString(),
        settings: file.settings,
      });
      worker.send(request);
    }
    if (flights.size === 0) {
      const extra = await worker.next(performance.now() + 20, signal);
      if (extra.kind === "aborted") signal.throwIfAborted();
      return extra.kind === "line" ? "protocol" : "complete";
    }
    const deadline = Math.min(
      ...Array.from(
        flights.values(),
        ({ attempt: pending, cancel }) => cancel?.deadline ?? pending.deadline,
      ),
    );
    const frame = await worker.next(deadline, signal);
    if (frame.kind === "aborted") {
      for (const { request } of flights.values())
        worker.send({ schema: "ichnaea.cancel/1", trial: request.trial });
      signal.throwIfAborted();
    }
    if (frame.kind === "closed")
      return timedOut || performance.now() >= deadline ? "worker-unresponsive" : "worker-closed";
    if (frame.kind === "timeout") {
      if ([...flights.values()].some(({ cancel }) => cancel && cancel.deadline <= deadline))
        return "worker-unresponsive";
      for (const settlement of runner.expire(deadline)) {
        timedOut = true;
        const flight = flights.get(settlement.attempt.trial.id);
        if (!flight) throw new Error("missing expired attempt");
        await work.expire(flight.request.trial);
        worker.send({ schema: "ichnaea.cancel/1", trial: flight.request.trial });
        flight.cancel = { deadline: performance.now() + CANCEL_MS, settlement };
      }
      continue;
    }
    if (frame.kind !== "line") throw new Error("trial was interrupted");
    let value: unknown;
    try {
      value = JSON.parse(frame.text);
    } catch {
      return "protocol";
    }
    const result = readWorkerRecord("ichnaea.trialResult/1", TrialResult, value);
    const event = result
      ? undefined
      : readWorkerRecord("ichnaea.workerEvent/1", WorkerEvent, value);
    const identity = result?.trial ?? event?.trial;
    const flight = identity && flights.get(identity.id);
    if (!identity || !flight || canonicalize(identity) !== canonicalize(flight.request.trial))
      return "protocol";
    if (flight.cancel) {
      if (!result) continue;
      const { settlement } = flight.cancel;
      const calls = Math.max(settlement.calls, result.usage.calls);
      const timeout: TrialResult = {
        schema: result.schema,
        dataClass: flight.request.dataClass,
        trial: flight.request.trial,
        context: result.context,
        observed: { kind: "settings", configuration: flight.settings },
        usage: { calls, responseIds: [] },
        failure: { class: "system", kind: "timeout" },
      };
      await settle(flight, settlement, timeout);
      if (calls > settlement.calls) return "budget-exceeded";
      continue;
    }
    if (frame.received >= flight.attempt.deadline) return "protocol";
    if (event) {
      if (event.kind === "heartbeat" && event.calls > flight.attempt.calls) {
        const overrun = TrialResult.parse({
          schema: "ichnaea.trialResult/1",
          trial: flight.request.trial,
          dataClass: flight.request.dataClass,
          observed: { kind: "unavailable" },
          usage: { calls: event.calls, responseIds: [] },
        });
        await settle(flight, runner.accept(block.block, overrun, frame.received), overrun);
        return "budget-exceeded";
      }
      continue;
    }
    if (!result) return "protocol";
    let admitted = result;
    let artifacts: Trial["evidence"];
    if (!result.failure && !result.truncated && result.artifacts?.length) {
      const dataClass = result.artifacts.reduce(
        (current, item) =>
          item.class !== undefined && classRank(item.class) > classRank(current)
            ? item.class
            : current,
        result.dataClass,
      );
      const captured = await captureArtifacts(
        work.directory,
        flight.request.workdir,
        result.artifacts,
      );
      if ("failure" in captured) {
        admitted = {
          ...result,
          dataClass,
          failure: captured.failure,
          output: undefined,
          pointer: undefined,
          artifacts: undefined,
        };
      } else {
        admitted = { ...result, dataClass };
        artifacts = captured.evidence;
      }
    }
    const settlement = runner.accept(block.block, admitted, frame.received);
    const failure = await settle(flight, settlement, admitted, artifacts);
    if (failure) return failure;
    if (settlement.disposition === "protocol" || settlement.disposition === "budget-exceeded")
      return settlement.disposition;
  }
}
