import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { WorkerReady } from "../contracts/records/worker.js";
const MAX_LINE_BYTES = 8 * 1024 * 1024;
const MAX_QUEUED_LINES = 1024;
const MAX_QUEUED_BYTES = 2 * MAX_LINE_BYTES;
class Transport {
    #child;
    #closed;
    #queue = [];
    #queuedBytes = 0;
    #parts = [];
    #bytes = 0;
    #ended;
    #notify;
    #closing;
    constructor(command, args, diagnostic) {
        const child = spawn(command, args, { detached: process.platform !== "win32" });
        this.#child = child;
        this.#closed = once(child, "close").catch(() => undefined);
        child.on("error", () => this.#end("worker could not start"));
        child.stdin.on("error", () => this.#end("worker closed stdin"));
        child.stdout.on("end", () => this.#end(this.#bytes ? "worker ended mid-line" : "worker closed stdout"));
        child.stdout.on("data", (data) => this.#receive(data));
        const stderr = createInterface({ input: child.stderr, crlfDelay: Infinity });
        stderr.on("line", diagnostic);
    }
    #end(reason) {
        this.#ended ??= { kind: "closed", reason };
        this.#notify?.();
    }
    #receive(data) {
        let offset = 0;
        while (!this.#ended && offset < data.length) {
            const newline = data.indexOf(10, offset);
            const part = data.subarray(offset, newline < 0 ? data.length : newline);
            this.#bytes += part.length;
            if (this.#bytes > MAX_LINE_BYTES) {
                this.#end("worker line exceeds the size limit");
                return;
            }
            this.#parts.push(part);
            if (newline < 0)
                return;
            if (this.#queue.length >= MAX_QUEUED_LINES ||
                this.#queuedBytes + this.#bytes > MAX_QUEUED_BYTES) {
                this.#end("worker sent too much unread protocol data");
                return;
            }
            try {
                const text = new TextDecoder("utf-8", { fatal: true })
                    .decode(Buffer.concat(this.#parts, this.#bytes))
                    .replace(/\r$/, "");
                this.#queue.push({
                    frame: { kind: "line", text, received: performance.now() },
                    bytes: this.#bytes,
                });
            }
            catch {
                this.#end("worker line is not UTF-8");
                return;
            }
            this.#queuedBytes += this.#bytes;
            this.#parts = [];
            this.#bytes = 0;
            offset = newline + 1;
            this.#notify?.();
        }
    }
    async next(deadline, signal) {
        if (signal?.aborted)
            return { kind: "aborted" };
        if (this.#notify)
            throw new Error("another worker read is in progress");
        const available = () => {
            const next = this.#queue[0];
            if (!next)
                return this.#ended;
            if (next.frame.received > deadline)
                return { kind: "timeout" };
            this.#queue.shift();
            this.#queuedBytes -= next.bytes;
            return next.frame;
        };
        const frame = available();
        if (frame)
            return frame;
        const wait = deadline - performance.now();
        if (wait <= 0)
            return { kind: "timeout" };
        return new Promise((resolve) => {
            const finish = (result) => {
                clearTimeout(timer);
                signal?.removeEventListener("abort", abort);
                this.#notify = undefined;
                resolve(result);
            };
            const abort = () => finish({ kind: "aborted" });
            const timer = setTimeout(() => finish({ kind: "timeout" }), Math.ceil(wait));
            this.#notify = () => {
                const result = available();
                if (result)
                    finish(result);
            };
            signal?.addEventListener("abort", abort, { once: true });
        });
    }
    send(record) {
        if (this.#ended)
            throw new Error("worker transport is closed");
        this.#child.stdin.write(`${JSON.stringify(record)}\n`);
    }
    async close() {
        this.#closing ??= this.#stop();
        await this.#closing;
    }
    async #stop() {
        this.#end("worker transport is closed");
        this.#child.stdin.destroy();
        const pid = this.#child.pid;
        if (pid !== undefined) {
            try {
                process.kill(process.platform === "win32" ? pid : -pid, "SIGKILL");
            }
            catch (error) {
                const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
                if (code === "EPERM" && process.platform === "darwin")
                    this.#child.kill("SIGKILL");
                else if (code !== "ESRCH")
                    throw error;
            }
        }
        this.#child.stdout.destroy();
        this.#child.stderr.destroy();
        await this.#closed;
    }
}
/** A local command with a validated trial protocol handshake. */
export class CommandWorker {
    ready;
    #transport;
    constructor(ready, transport) {
        this.ready = ready;
        this.#transport = transport;
    }
    static async start(argv, timeoutMs, diagnostic, signal) {
        const [command, ...args] = argv;
        if (!command)
            throw new Error("worker command is empty");
        const transport = new Transport(command, args, diagnostic);
        try {
            const frame = await transport.next(performance.now() + timeoutMs, signal);
            if (frame.kind !== "line") {
                const reason = frame.kind === "closed" ? frame.reason : frame.kind;
                throw new Error(`worker handshake failed: ${reason}`);
            }
            let line;
            try {
                line = JSON.parse(frame.text);
            }
            catch {
                throw new Error("worker handshake is not JSON");
            }
            // Readers tolerate optional members added by a newer worker.
            const ready = WorkerReady.strip().safeParse(line);
            if (!ready.success || ready.data.protocol !== "ichnaea.trialRequest/1")
                throw new Error("worker handshake must announce the trial request protocol");
            return new CommandWorker(ready.data, transport);
        }
        catch (error) {
            await transport.close();
            throw error;
        }
    }
    next(deadline, signal) {
        return this.#transport.next(deadline, signal);
    }
    send(record) {
        this.#transport.send(record);
    }
    close() {
        return this.#transport.close();
    }
}
//# sourceMappingURL=worker-transport.js.map