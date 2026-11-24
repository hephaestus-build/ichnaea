import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import * as z from "zod";
import { canonicalize } from "../contracts/canonical.js";
import { classRank } from "../contracts/data-class.js";
import { Json, RecordDataClass } from "../contracts/primitives.js";
import { Cancel, TrialIdentity, TrialRequest, TrialResult, WorkerReady, } from "../contracts/records/worker.js";
import { sha256Hex } from "../contracts/sha256.js";
import { readWorkerRecord } from "./worker-record.js";
const Settings = z.record(z.string(), Json);
let processContext;
function write(record) {
    const line = `${JSON.stringify(record)}\n`;
    return new Promise((resolve, reject) => process.stdout.write(line, (error) => (error ? reject(error) : resolve())));
}
function refused(trial, dataClass, kind) {
    return TrialResult.parse({
        schema: "ichnaea.trialResult/1",
        dataClass,
        trial,
        failure: { class: "protocol", kind },
        usage: { calls: 0, responseIds: [] },
        observed: { kind: "unavailable" },
    });
}
async function respond(request, context, signal, handler) {
    let settings;
    let bytes;
    try {
        bytes = await readFile(request.configuration.path);
        const json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        settings = Settings.parse(json);
    }
    catch {
        return refused(request.trial, request.dataClass, "invalid-settings");
    }
    let reply;
    try {
        signal.throwIfAborted();
        reply = await handler({
            case: request.case,
            arm: { settings },
            workdir: request.workdir,
            limits: request.limits,
            signal,
        });
    }
    catch (error) {
        if (!signal.aborted ||
            (error !== signal.reason && !(error instanceof Error && error.name === "AbortError"))) {
            throw error;
        }
        // The callback stopped before it could report usage. Charge the full attempt allowance.
        reply = {
            failure: { class: "system", kind: "cancelled" },
            usage: { calls: request.limits.calls ?? 1, responseIds: [] },
        };
    }
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
export async function serveWorker(handler, options = {}) {
    const ready = WorkerReady.parse({
        schema: "ichnaea.workerReady/1",
        protocol: "ichnaea.trialRequest/1",
        capacity: options.capacity ?? 1,
        runtime: `node/${process.versions.node}`,
    });
    const context = (processContext ??= randomUUID());
    const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
    const pending = new Map();
    const received = new Set();
    let failed = false;
    try {
        await write(ready);
        for await (const line of input) {
            let value;
            try {
                value = JSON.parse(line);
            }
            catch {
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
                await write(invalid.success
                    ? refused(invalid.data.trial, invalid.data.dataClass ?? "none", "bad-request")
                    : { schema: "ichnaea.workerError/1", dataClass: "none", kind: "not-a-request" });
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
        if (failed)
            throw new Error("worker callback failed before it could send a valid result");
    }
    finally {
        input.close();
        for (const { controller } of pending.values())
            controller.abort();
    }
}
//# sourceMappingURL=serve-worker.js.map