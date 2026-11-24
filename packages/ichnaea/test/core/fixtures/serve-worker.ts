import { writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";

import { serveWorker } from "../../../src/core/serve-worker.ts";

await serveWorker(async ({ arm, limits, case: trialCase, signal, workdir }) => {
  if (trialCase.input["wait"] === true) {
    process.stderr.write("callback started\n");
    await setTimeout(30_000, undefined, { signal });
  }
  if (process.argv[2] === "ignore-first-cancel" && basename(dirname(workdir)) === "0")
    await setTimeout(30_000);
  if (process.argv[2] === "artifact") {
    await writeFile(join(workdir, "answer.txt"), "Paris");
    return { artifacts: [{ name: "answer", path: "answer.txt", mediaType: "text/plain" }] };
  }
  return {
    output: arm.settings["answer"] ?? null,
    ...(limits.calls === 0 || process.argv[2] === "use-limit"
      ? { usage: { calls: limits.calls ?? 1, responseIds: [] } }
      : {}),
    ...(process.argv[2] === "external" ? { context: "server-instance" } : {}),
  };
});
