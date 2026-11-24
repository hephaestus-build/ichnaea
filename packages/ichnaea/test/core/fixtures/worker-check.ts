import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { setTimeout } from "node:timers/promises";

import { TrialRequest, TrialResult } from "../../../src/contracts/records/worker.ts";

const mode = process.argv[2];
process.stderr.write("fixture ready\n");
const template = TrialResult.parse(
  JSON.parse(
    await readFile(new URL("../../../fixtures/valid/trialResult.json", import.meta.url), "utf8"),
  ),
);
const send = (record: unknown): void => void process.stdout.write(`${JSON.stringify(record)}\n`);
send({ schema: "ichnaea.workerReady/1", protocol: "ichnaea.trialRequest/1", capacity: 2 });
const received: TrialRequest[] = [];
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  received.push(TrialRequest.parse(JSON.parse(line)));
  if (received.length !== 2) continue;
  const [first, second] = received;
  if (!first || !second) throw new Error("fixture needs two requests");
  if (mode === "late") await setTimeout(2_500);
  const result = { ...template, trial: second.trial, usage: { calls: 0, responseIds: [] } };
  if (mode === "unknown") {
    send({ ...result, trial: { ...second.trial, id: "unexpected" } });
  } else {
    send(result);
    if (mode === "duplicate") send(result);
    send({ ...result, trial: first.trial });
  }
}
