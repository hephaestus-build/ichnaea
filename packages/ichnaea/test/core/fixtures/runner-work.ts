import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";

const [, , mode, root] = process.argv;
if (mode === "crash") {
  if (!root) throw new Error("expected a work root");
  const { RunWork } = await import("../../../src/core/runner-work.ts");
  const { CommandWorker } = await import("../../../src/core/worker-transport.ts");
  const { TrialRequest } = await import("../../../src/contracts/records/worker.ts");
  const request = TrialRequest.parse(
    JSON.parse(
      await readFile(new URL("../../../fixtures/valid/trialRequest.json", import.meta.url), "utf8"),
    ),
  );
  const work = await RunWork.open(root, "crash");
  const worker = await CommandWorker.start(
    [process.execPath, import.meta.filename, "hold"],
    1_500,
    () => undefined,
  );
  await work.startBlock({ endpoint: "example", cap: 10, calls: 4 }, () => "base");
  await work.handshake(worker.ready);
  await work.intent(request.trial);
  worker.send(request);
  const frame = await worker.next(performance.now() + 1_500);
  if (frame.kind !== "line" || frame.text !== "dispatched")
    throw new Error("worker did not receive the request");
  process.stdout.write("dispatched\n");
  // Leave the lease open and exit before recording an outcome.
  process.exit(0);
} else if (mode !== "early-exit") {
  if (mode === "ready") process.stderr.write("synthetic diagnostic\n");
  const ready = {
    schema: "ichnaea.workerReady/1",
    protocol: mode === "wrong-protocol" ? "ichnaea.scoreRequest/1" : "ichnaea.trialRequest/1",
    capacity: 1,
    runtime: "fixture/1",
    harness: "synthetic",
  };
  process.stdout.write(`${mode === "bad-json" ? "{" : JSON.stringify(ready)}\n`);
  for await (const line of createInterface({ input: process.stdin })) {
    const value: unknown = JSON.parse(line);
    if (
      mode === "hold" &&
      typeof value === "object" &&
      value !== null &&
      "schema" in value &&
      value.schema === "ichnaea.trialRequest/1"
    ) {
      process.stdout.write("dispatched\n");
    }
  }
}
