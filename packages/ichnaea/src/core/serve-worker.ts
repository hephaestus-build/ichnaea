import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";

import * as z from "zod";

import { canonicalize } from "../contracts/canonical.ts";
import { classRank } from "../contracts/data-class.ts";
import { Json, RecordDataClass } from "../contracts/primitives.ts";
import {
  Cancel,
  type ObservedConfiguration,
  TrialIdentity,
  TrialRequest,
  TrialResult,
  WorkerReady,
} from "../contracts/records/worker.ts";
import { sha256Hex } from "../contracts/sha256.ts";

import { readWorkerRecord } from "./worker-record.ts";

const Settings = z.record(z.string(), Json);
let processContext: string | undefined;

/** The inputs a worker callback receives, with the arm's role and case references omitted. */
export interface WorkerTrial {
  /** Input, turns and fixtures from the selected case. */
  readonly case: TrialRequest["case"];
  /** The opaque arm's settings, read from the file supplied by the runner. */
  readonly arm: { readonly settings: Readonly<Record<string, Json>> };
  /** Directory for the trial's artifacts. */
  readonly workdir: string;
  /** Call limit for this attempt. */
  readonly limits: TrialRequest["limits"];
  /** Aborted when the runner cancels this attempt. */
  readonly signal: AbortSignal;
}

/** The reply from a worker callback. Ichnaea binds it to the request. */
export type WorkerReply = Omit<
  TrialResult,
  "schema" | "trial" | "dataClass" | "observed" | "usage"
> & {
  readonly observed?: ObservedConfiguration;
  /** Omit only for exactly one accepted call. Report 0 for a local computation with no calls. */
  readonly usage?: TrialResult["usage"];
  readonly dataClass?: TrialResult["dataClass"];
};

function write(record: unknown): Promise<void> {
  const line = `${JSON.stringify(record)}\n`;
  return new Promise((resolve, reject) =>
    process.stdout.write(line, (error) => (error ? reject(error) : resolve())),
  );
}

function refused(
  trial: TrialIdentity,
  dataClass: TrialRequest["dataClass"],
  kind: string,
): TrialResult {
  return TrialResult.parse({
    schema: "ichnaea.trialResult/1",
    dataClass,
    trial,
    failure: { class: "protocol", kind },
    usage: { calls: 0, responseIds: [] },
    observed: { kind: "unavailable" },
  });
}

async function respond(
  request: TrialRequest,
  context: string,
  signal: AbortSignal,
  handler: (trial: WorkerTrial) => WorkerReply | Promise<WorkerReply>,
): Promise<TrialResult> {
  let settings: z.infer<typeof Settings>;
  let bytes: Uint8Array;
  try {
    bytes = await readFile(request.configuration.path);
    const json: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    settings = Settings.parse(json);
  } catch {
    return refused(request.trial, request.dataClass, "invalid-settings");
  }
  const reply = await handler({
    case: request.case,
    arm: { settings },
    workdir: request.workdir,
    limits: request.limits,
    signal,
  });
  const dataClass = reply.dataClass ?? request.dataClass;
  if (classRank(dataClass) < classRank(request.dataClass))
    throw new Error("the callback lowered the data class");
  return TrialResult.parse({
    ...reply,
    schema: "ichnaea.trialResult/1",
    dataClass,
    trial: request.trial,
    usage: reply.usage ?? { calls: 1, responseIds: [] },
    context: reply.context ?? context,
    observed: reply.observed ?? { kind: "settings", configuration: `sha256:${sha256Hex(bytes)}` },
  });
}

/** Serve trial requests on stdin and write protocol records to stdout. Send diagnostics to stderr. */
export async function serveWorker(
  handler: (trial: WorkerTrial) => WorkerReply | Promise<WorkerReply>,
  options: { readonly capacity?: number } = {},
): Promise<void> {
  const ready = WorkerReady.parse({
    schema: "ichnaea.workerReady/1",
    protocol: "ichnaea.trialRequest/1",
    capacity: options.capacity ?? 1,
    runtime: `node/${process.versions.node}`,
  });
  const context = (processContext ??= randomUUID());
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const pending = new Map<string, { controller: AbortController; done: Promise<void> }>();
  const received = new Set<string>();
  let failed = false;
  try {
    await write(ready);
    for await (const line of input) {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        await write({ schema: "ichnaea.workerError/1", dataClass: "none", kind: "bad-json" });
        break;
      }
      const cancel = readWorkerRecord("ichnaea.cancel/1", Cancel, value);
      if (cancel && "trial" in cancel) {
        pending.get(canonicalize(cancel.trial))?.controller.abort();
        continue;
      }
      const request = readWorkerRecord("ichnaea.trialRequest/1", TrialRequest, value);
      if (!request) {
        const invalid = z
          .looseObject({
            schema: z.literal("ichnaea.trialRequest/1"),
            trial: TrialIdentity.strip(),
            dataClass: RecordDataClass.optional(),
          })
          .safeParse(value);
        await write(
          invalid.success
            ? refused(invalid.data.trial, invalid.data.dataClass ?? "none", "bad-request")
            : { schema: "ichnaea.workerError/1", dataClass: "none", kind: "not-a-request" },
        );
        break;
      }
      const key = canonicalize(request.trial);
      if (received.has(key) || pending.size === ready.capacity) {
        await write(refused(request.trial, request.dataClass, "unexpected-attempt"));
        break;
      }
      received.add(key);
      const controller = new AbortController();
      const done = respond(request, context, controller.signal, handler)
        .then(write)
        .catch(() => {
          failed = true;
          input.close();
        })
        .finally(() => pending.delete(key))
        .then(() => undefined);
      pending.set(key, { controller, done });
    }
    await Promise.all([...pending.values()].map(({ done }) => done));
    if (failed) throw new Error("worker callback failed before it could send a valid result");
  } finally {
    input.close();
    for (const { controller } of pending.values()) controller.abort();
  }
}
