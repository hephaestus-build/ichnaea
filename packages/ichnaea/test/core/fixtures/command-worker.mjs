// A local command worker for runner conformance tests. It reads no real cases and calls no model.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const [, , mode, log] = process.argv;
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const record = (value) => appendFileSync(log, `${JSON.stringify(value)}\n`);
const pending = [];
const held = new Map();
const restarted = existsSync(log);
record({ kind: "started" });
if (mode === "exit-before-ready") process.exit(1);
const parallel = mode === "reverse" || mode === "ordered-deadline";
send({
  schema: "ichnaea.workerReady/1",
  protocol: "ichnaea.trialRequest/1",
  capacity: parallel ? 2 : 1,
});

function respond(request, failure, observedModel, throttled) {
  const file = readFileSync(request.configuration.path, "utf8");
  const configuration = JSON.parse(file);
  send({
    schema: "ichnaea.trialResult/1",
    dataClass: request.dataClass,
    trial: request.trial,
    ...(failure ? { failure } : { output: { text: "example" } }),
    usage: { calls: 0, responseIds: [], ...(throttled ? { throttled } : {}) },
    observed: {
      configuration: `sha256:${createHash("sha256").update(file).digest("hex")}`,
      code: { commit: configuration.factors["code.commit"].value },
      model: observedModel ?? configuration.models[0].id.value,
      route: `sha256:${"e".repeat(64)}`,
      parameters: Object.fromEntries(configuration.parameters.map((p) => [p.name, p.value])),
      configurationRead: [],
      environment: {},
    },
  });
}

let first;
let second;
for await (const line of createInterface({ input: process.stdin })) {
  const value = JSON.parse(line);
  record({ kind: value.schema, trial: value.trial });
  if (value.schema === "ichnaea.cancel/1") {
    const request = held.get(value.trial.id);
    if (request) respond(request, { class: "system", kind: "stopped" });
    if (mode === "ordered-deadline" && pending.length) respond(pending.shift());
    continue;
  }
  first ??= value.trial.id;
  if (value.trial.id !== first) second ??= value.trial.id;

  if (mode === "exit" && !restarted) {
    process.exit(0);
  } else if (mode === "throttled" && value.trial.id === first) {
    const waitingSince = performance.now();
    const throttled = () => ({ count: 1, ms: Math.floor(performance.now() - waitingSince) });
    const heartbeat = () =>
      send({
        schema: "ichnaea.workerEvent/1",
        trial: value.trial,
        kind: "heartbeat",
        calls: 0,
        throttled: throttled(),
      });
    heartbeat();
    const interval = setInterval(heartbeat, 50);
    setTimeout(() => {
      clearInterval(interval);
      respond(value, undefined, undefined, throttled());
    }, 900);
  } else if (mode === "ordered-deadline" && value.trial.id === first) {
    held.set(value.trial.id, value);
  } else if (mode === "ordered-deadline" && value.trial.id === second && held.size) {
    pending.push(value);
  } else if (mode === "reverse") {
    pending.push(value);
    if (pending.length === 2) respond(pending[1]);
  } else if (mode === "deadline" && value.trial.id === first) {
    held.set(value.trial.id, value);
  } else if (mode === "retry" && value.trial.id === first && value.trial.attempt === 1) {
    respond(value, { class: "infrastructure", kind: "temporary" });
  } else if (mode === "retry" && value.trial.id === second) {
    respond(value, { class: "system", kind: "broken" });
  } else {
    respond(value, undefined, mode === "mismatch" ? "unexpected-model" : undefined);
  }
}
