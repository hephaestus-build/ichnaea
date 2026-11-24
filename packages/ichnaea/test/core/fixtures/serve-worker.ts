import { setTimeout } from "node:timers/promises";

import { serveWorker } from "../../../src/core/serve-worker.ts";

await serveWorker(async ({ arm, limits, case: trialCase, signal }) => {
  if (trialCase.input["wait"] === true) {
    process.stderr.write("callback started\n");
    await setTimeout(30_000, undefined, { signal });
  }
  return {
    output: arm.settings["answer"] ?? null,
    ...(limits.calls === 0 ? { usage: { calls: 0, responseIds: [] } } : {}),
    ...(process.argv[2] === "external" ? { context: "server-instance" } : {}),
  };
});
