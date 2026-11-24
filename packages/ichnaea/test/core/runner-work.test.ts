import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import fc from "fast-check";
import { afterEach, beforeEach, expect, it } from "vitest";

import { TrialRequest } from "../../src/contracts/records/worker.ts";
import { CallLedger } from "../../src/core/ledger.ts";
import { RunWork } from "../../src/core/runner-work.ts";
import { CommandWorker } from "../../src/core/worker-transport.ts";

const fixture = join(import.meta.dirname, "fixtures", "runner-work.ts");
const booking = { endpoint: "example", cap: 10, calls: 4 };
const at = new Date().toISOString();
const { trial } = TrialRequest.parse(
  JSON.parse(
    await readFile(new URL("../../fixtures/valid/trialRequest.json", import.meta.url), "utf8"),
  ),
);
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ichnaea-work-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("allows only one concurrent resume, then lets another runner resume after release", async () => {
  const results = await Promise.allSettled([
    RunWork.open(root, "resume"),
    RunWork.open(root, "resume"),
  ]);
  const owners = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  expect(owners).toHaveLength(1);
  expect(results).toContainEqual({
    status: "rejected",
    reason: expect.objectContaining({ message: expect.stringMatching(/owned/) }),
  });
  await owners[0]?.close();
  const work = await RunWork.open(root, "resume");
  expect(await work.entries()).toEqual([{ kind: "receipt" }]);
  await work.close();
});

it("abandons a dispatched block when its runner dies and charges both draws", async () => {
  const output = execFileSync(process.execPath, [fixture, "crash", root], { encoding: "utf8" });
  expect(output.trim()).toBe("dispatched");
  const work = await RunWork.open(root, "crash");
  try {
    const replacement = await work.startBlock(booking, (draw) =>
      draw % 2 === 0 ? "base" : "candidate",
    );
    expect(replacement).toEqual({ kind: "block-start", block: 1, first: "candidate" });
    await expect(work.outcome(trial, { output: true })).rejects.toThrow(/no outstanding intent/);
    await work.intent(trial);
    await expect(work.completeBlock()).rejects.toThrow(/attempts without outcomes/);
    await work.outcome(trial, { output: true });
    await work.completeBlock();
    const entries = await work.entries();
    expect(entries).toEqual([
      { kind: "receipt" },
      { kind: "block-start", block: 0, first: "base" },
      { kind: "handshake", block: 0, ready: expect.objectContaining({ capacity: 1 }) },
      { kind: "intent", block: 0, trial },
      {
        kind: "owner-takeover",
        previous: expect.objectContaining({ pid: expect.any(Number) }),
        cause: "dead-pid",
      },
      { kind: "block-abandoned", block: 0 },
      replacement,
      { kind: "intent", block: 1, trial },
      { kind: "outcome", block: 1, trial, result: { output: true } },
      { kind: "block-complete", block: 1 },
    ]);
    expect(await new CallLedger(root).used(booking.endpoint, at)).toBe(8);
    await expect(work.startBlock(booking, () => "base")).rejects.toThrow(/8 of 10/);
  } finally {
    await work.close();
  }
});

it("takes over a ten-minute lease and fences the prior owner", async () => {
  const first = await RunWork.open(root, "expired");
  const past = new Date(Date.now() - 600_000);
  await utimes(join(root, "owners", "expired", "0"), past, past);
  const next = await RunWork.open(root, "expired");
  try {
    expect(await next.entries()).toContainEqual({
      kind: "owner-takeover",
      previous: expect.objectContaining({ pid: process.pid }),
      cause: "expired-lease",
    });
    await expect(first.startBlock(booking, () => "base")).rejects.toThrow(/ownership lost/);
    await first.close();
    await next.startBlock(booking, () => "base");
  } finally {
    await first.close();
    await next.close();
  }
});

it("keeps a run ID inside the work area", async () => {
  await fc.assert(
    fc.asyncProperty(fc.stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9+:/._-]{0,35}$/), async (id) => {
      const work = await RunWork.open(root, id);
      try {
        expect(work.directory).toBe(join(root, "work", encodeURIComponent(id)));
      } finally {
        await work.close();
      }
    }),
    { numRuns: 25 },
  );
  for (const id of [".", "..", ""]) await expect(RunWork.open(root, id)).rejects.toThrow();
});

it("requires the trial handshake before dispatch and separates worker diagnostics", async () => {
  const diagnostics: string[] = [];
  const worker = await CommandWorker.start([process.execPath, fixture, "ready"], 1_500, (line) =>
    diagnostics.push(line),
  );
  try {
    expect(worker.ready).toMatchObject({ capacity: 1, runtime: "fixture/1", harness: "synthetic" });
    await expect.poll(() => diagnostics).toEqual(["synthetic diagnostic"]);
    const work = await RunWork.open(root, "handshake");
    try {
      await work.startBlock(booking, () => "base");
      await work.handshake(worker.ready);
      expect(await work.entries()).toContainEqual({
        kind: "handshake",
        block: 0,
        ready: worker.ready,
      });
    } finally {
      await work.close();
    }
    await expect(worker.next(performance.now() + 20)).resolves.toEqual({ kind: "timeout" });
  } finally {
    await worker.close();
  }
  for (const mode of ["wrong-protocol", "bad-json", "early-exit"]) {
    await expect(
      CommandWorker.start([process.execPath, fixture, mode], 1_500, () => undefined),
    ).rejects.toThrow(/handshake/);
  }
});
