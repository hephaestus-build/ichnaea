import { serveWorker } from "../../../src/core/serve-worker.ts";

await serveWorker(async ({ arm, limits }) => ({
  output: arm.settings["answer"] ?? null,
  ...(limits.calls === 0 ? { usage: { calls: 0, responseIds: [] } } : {}),
  ...(process.argv[2] === "external" ? { context: "server-instance" } : {}),
}));
