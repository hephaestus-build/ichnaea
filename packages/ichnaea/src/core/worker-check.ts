import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalize, digest } from "../contracts/canonical.ts";
import { TrialRequest, TrialResult, WorkerEvent } from "../contracts/records/worker.ts";

import { CliError, type Command } from "./command-grammar.ts";
import { readWorkerRecord } from "./worker-record.ts";
import { CommandWorker } from "./worker-transport.ts";

const DEADLINE_MS = 1_000;
const caseInput = { check: "echo" };
const settings = {
  schema: "ichnaea.configuration/1",
  description: "Worker conformance fixture",
  models: [
    {
      role: "answer",
      provider: { value: "fixture", status: "declared" },
      id: { value: "fixture", status: "declared" },
    },
  ],
  parameters: [{ name: "temperature", value: 0, status: "declared", origin: "explicit" }],
  prompts: [],
  factors: {},
};

function vectorRequest(index: number, workdir: string, configuration: string): TrialRequest {
  return TrialRequest.parse({
    schema: "ichnaea.trialRequest/1",
    dataClass: "none",
    plan: digest({ fixture: "worker-check" }),
    trial: {
      suite: "worker-check",
      arm: "a",
      replicate: 0,
      attempt: 1,
      id: `vector/${index}`,
      case: `check-${index}`,
    },
    case: {
      id: `check-${index}`,
      digest: digest({ ...caseInput, index }),
      unit: "session",
      input: caseInput,
    },
    limits: { calls: 0 },
    deadline: "PT1S",
    workdir,
    configuration: { path: configuration },
  });
}

function fail(message: string): never {
  throw new CliError("COMMAND_FAILED", message, { publicMessage: message });
}

async function check(worker: CommandWorker, requests: readonly TrialRequest[]): Promise<string[]> {
  const pending = new Map<string, { request: TrialRequest; deadline: number }>();
  const done = new Set<string>();
  const replies: string[] = [];
  let sent = 0;
  while (true) {
    while (sent < requests.length && pending.size < worker.ready.capacity) {
      const request = requests[sent++];
      if (!request) throw new Error("missing conformance request");
      pending.set(request.trial.id, { request, deadline: performance.now() + DEADLINE_MS });
      worker.send(request);
    }
    const complete = replies.length === requests.length;
    const deadline = complete
      ? performance.now() + 100
      : Math.min(...[...pending.values()].map((attempt) => attempt.deadline));
    const frame = await worker.next(deadline);
    if (frame.kind !== "line") {
      if (complete && (frame.kind === "closed" || frame.kind === "timeout")) return replies;
      if (frame.kind === "timeout") fail("worker did not answer before the deadline");
      fail("worker closed before answering every request");
    }
    let value: unknown;
    try {
      value = JSON.parse(frame.text);
    } catch {
      fail("worker wrote a line that is not JSON");
    }
    const result = readWorkerRecord("ichnaea.trialResult/1", TrialResult, value);
    const event = result
      ? undefined
      : readWorkerRecord("ichnaea.workerEvent/1", WorkerEvent, value);
    const trial = result?.trial ?? event?.trial;
    if (trial === undefined) fail("worker returned an invalid protocol record");
    if (done.has(trial.id)) fail("worker returned a duplicate result");
    const expected = pending.get(trial.id);
    if (!expected || canonicalize(expected.request.trial) !== canonicalize(trial))
      fail("worker returned a result for an unknown attempt");
    if (frame.received >= expected.deadline) fail("worker did not answer before the deadline");
    if ((result?.usage.calls ?? (event?.kind === "heartbeat" ? event.calls : 0)) !== 0)
      fail("worker exceeded the zero-call limit for the conformance check");
    if (result?.failure?.class === "protocol") fail("worker refused a valid request");
    if (result) {
      if ("kind" in result.observed && result.observed.kind === "unavailable")
        fail("worker returned no configuration evidence");
      pending.delete(trial.id);
      done.add(trial.id);
      replies.push(trial.id);
    }
  }
}

export const workerCommand: Command = {
  name: "worker",
  description: "Check that a worker obeys the request protocol",
  positionals: ["check"],
  options: {},
  worker: true,
  async run(args, _load, diagnostic) {
    if (args.positionals[0] !== "check") throw new CliError("USAGE", "worker: expected 'check'");
    const workdir = await mkdtemp(join(tmpdir(), "ichnaea-worker-check-"));
    try {
      const configuration = join(workdir, "configuration.json");
      await writeFile(configuration, canonicalize(settings));
      const worker = await CommandWorker.start(args.worker, 3_000, (line) =>
        diagnostic(`[worker] ${line}`),
      );
      try {
        const replies = await check(worker, [
          vectorRequest(1, workdir, configuration),
          vectorRequest(2, workdir, configuration),
        ]);
        return {
          code: 0,
          text: [
            `worker check: ${replies.length} replies matched (capacity ${worker.ready.capacity})`,
          ],
          json: { capacity: worker.ready.capacity, replies },
        };
      } finally {
        await worker.close();
      }
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  },
};
