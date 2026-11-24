import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

import { expect, it } from "vitest";

import {
  TrialRequest,
  TrialResult,
  WorkerError,
  WorkerReady,
} from "../../src/contracts/records/worker.ts";
import { sha256Hex } from "../../src/contracts/sha256.ts";
import { CommandWorker } from "../../src/core/worker-transport.ts";

const fixture = join(import.meta.dirname, "fixtures", "serve-worker.ts");
const request = TrialRequest.parse(
  JSON.parse(
    await readFile(new URL("../../fixtures/valid/trialRequest.json", import.meta.url), "utf8"),
  ),
);

async function result(worker: CommandWorker, attempt: TrialRequest): Promise<TrialResult> {
  worker.send(attempt);
  const line = await worker.next(performance.now() + 1_000);
  if (line.kind !== "line") throw new Error(`expected a result, got ${line.kind}`);
  return TrialResult.parse(JSON.parse(line.text));
}

it("serves a callback with the arm settings and a default context for each process", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ichnaea-serve-worker-"));
  const contexts = new Set<string>();
  try {
    const configuration = { path: join(directory, "settings.json") };
    const bytes = new TextEncoder().encode(JSON.stringify({ answer: "Paris" }));
    await writeFile(configuration.path, bytes);
    const bound = { ...request, configuration };
    for (const mode of ["default", "default", "external"]) {
      const worker = await CommandWorker.start([process.execPath, fixture, mode], 3_000, () => {});
      try {
        expect(worker.ready.capacity).toBe(1);
        const first = await result(worker, bound);
        const again = await result(worker, { ...bound, trial: { ...bound.trial, attempt: 2 } });
        expect(first).toMatchObject({
          trial: bound.trial,
          output: "Paris",
          usage: { calls: 1 },
          observed: { kind: "settings", configuration: `sha256:${sha256Hex(bytes)}` },
        });
        expect(first.context).toEqual(again.context);
        if (!first.context) throw new Error("the worker must report a context");
        if (mode === "external") expect(first.context).toBe("server-instance");
        contexts.add(first.context);
      } finally {
        await worker.close();
      }
    }
    expect(contexts.size).toBe(3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it.each([
  ["malformed JSON", "{personal data", false],
  ["a request without its plan digest", JSON.stringify({ ...request, plan: undefined }), true],
] as const)("refuses %s before calling the application", async (_name, line, correlated) => {
  const child = spawn(process.execPath, [fixture], { stdio: ["pipe", "pipe", "ignore"] });
  child.stdin.end(`${line}\n`);
  child.stdout.setEncoding("utf8");
  let output = "";
  for await (const chunk of child.stdout) output += String(chunk);
  const frames: unknown[] = output
    .trim()
    .split("\n")
    .map((frame) => JSON.parse(frame));
  expect(frames).toHaveLength(2);
  expect(WorkerReady.parse(frames[0]).capacity).toBe(1);
  if (correlated)
    expect(TrialResult.parse(frames[1])).toMatchObject({
      trial: request.trial,
      failure: { class: "protocol", kind: "bad-request" },
      observed: { kind: "unavailable" },
    });
  else
    expect(WorkerError.parse(frames[1])).toEqual({
      schema: "ichnaea.workerError/1",
      dataClass: "none",
      kind: "bad-json",
    });
});

it("answers an aborted callback and serves the next trial in the same context", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ichnaea-cancel-worker-"));
  const started = Promise.withResolvers<void>();
  const wait = new AbortController();
  const worker = await CommandWorker.start([process.execPath, fixture], 3_000, (line) => {
    if (line === "callback started") started.resolve();
  });
  try {
    const path = join(directory, "settings.json");
    await writeFile(path, '{"answer":"Paris"}');
    const bound = { ...request, configuration: { path }, limits: { calls: 2 } };
    const paused = { ...bound, case: { ...bound.case, input: { wait: true } } };
    worker.send(paused);
    await Promise.race([
      started.promise,
      setTimeout(1_000, undefined, { signal: wait.signal }).then(() => {
        throw new Error("the paused callback did not start");
      }),
    ]);
    worker.send({ schema: "ichnaea.cancel/1", trial: paused.trial });
    const line = await worker.next(performance.now() + 1_000);
    if (line.kind !== "line") throw new Error(`expected a cancellation result, got ${line.kind}`);
    const cancelled = TrialResult.parse(JSON.parse(line.text));
    expect(cancelled).toMatchObject({
      trial: paused.trial,
      failure: { class: "system", kind: "cancelled" },
      usage: { calls: 2 },
    });
    const next = await result(worker, { ...bound, trial: { ...bound.trial, attempt: 2 } });
    expect(next.output).toBe("Paris");
    expect(next.context).toBe(cancelled.context);
  } finally {
    wait.abort();
    await worker.close();
    await rm(directory, { recursive: true, force: true });
  }
});
