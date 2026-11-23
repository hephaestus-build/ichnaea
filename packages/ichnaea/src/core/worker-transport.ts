import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";

const MAX_LINE = 8 * 1024 * 1024;

/** A frame received from the worker, or a local transport event. */
export type WorkerFrame =
  | { readonly line: string; readonly received: number }
  | { readonly ended: true; readonly reason: string }
  | { readonly timeout: true }
  | { readonly interrupted: true };

/** The local command transport. Only stdout is protocol input. */
export class WorkerTransport {
  readonly #process: ChildProcessWithoutNullStreams;
  readonly #closed: Promise<unknown>;
  readonly #queue: WorkerFrame[] = [];
  #ended: WorkerFrame | undefined;
  #notify: (() => void) | undefined;
  #buffer = "";
  #closing: Promise<void> | undefined;

  constructor(command: string, args: readonly string[]) {
    const child = spawn(command, args, { detached: process.platform !== "win32" });
    this.#process = child;
    this.#closed = once(child, "close").catch(() => undefined);
    child.stdout.setEncoding("utf8").on("data", (data: string) => this.#lines(data));
    child.stdout.on("end", () =>
      this.#end(this.#buffer ? "worker ended in a protocol line" : "worker closed stdout"),
    );
    child.stderr.resume();
    child.on("error", (error: NodeJS.ErrnoException) =>
      this.#end(`worker process error (${error.code ?? "unknown"})`),
    );
    child.stdin.on("error", () => this.#end("worker closed stdin"));
  }

  #end(reason: string): void {
    this.#ended ??= { ended: true, reason };
    this.#notify?.();
  }

  #lines(data: string): void {
    if (this.#ended) return;
    this.#buffer += data;
    let end = this.#buffer.indexOf("\n");
    while (end >= 0) {
      if (end > MAX_LINE) return this.#end("worker protocol line exceeds the size limit");
      this.#queue.push({
        line: this.#buffer.slice(0, end).replace(/\r$/, ""),
        received: performance.now(),
      });
      this.#buffer = this.#buffer.slice(end + 1);
      end = this.#buffer.indexOf("\n");
    }
    if (this.#buffer.length > MAX_LINE) this.#end("worker protocol line exceeds the size limit");
    if (this.#queue.length > 1024) this.#end("worker sent too many unread protocol lines");
    this.#notify?.();
  }

  /** Queues one JSON line. Deadlines continue while stdin is backpressured. */
  send(record: unknown): void {
    this.#process.stdin.write(`${JSON.stringify(record)}\n`);
  }

  /** Reads at most one line. A wait ending early leaves the next line queued. */
  async next(ms: number, signal?: AbortSignal): Promise<WorkerFrame> {
    if (signal?.aborted) return { interrupted: true };
    const expires = performance.now() + ms;
    const next = (): WorkerFrame | undefined => {
      const first = this.#queue[0];
      if (first && "received" in first && first.received > expires) return { timeout: true };
      return this.#queue.shift() ?? this.#ended;
    };
    const available = next();
    if (available) return available;
    if (ms <= 0) return { timeout: true };
    return new Promise((resolve) => {
      const finish = (frame: WorkerFrame): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.#notify = undefined;
        resolve(frame);
      };
      const abort = (): void => finish({ interrupted: true });
      const timer = setTimeout(() => finish({ timeout: true }), ms);
      this.#notify = (): void => {
        const frame = next();
        if (frame) finish(frame);
      };
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  /** Stops this worker's process group, including its child processes. */
  async close(): Promise<void> {
    this.#closing ??= this.#stop();
    await this.#closing;
  }

  async #stop(): Promise<void> {
    this.#process.stdin.destroy();
    const pid = this.#process.pid;
    if (pid !== undefined) {
      try {
        process.kill(process.platform === "win32" ? pid : -pid, "SIGKILL");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        // macOS may retain the exited child's group until it reaps the child.
        if (code === "EPERM" && process.platform === "darwin") this.#process.kill("SIGKILL");
        else if (code !== "ESRCH") throw error;
      }
    }
    this.#process.stdout.destroy();
    this.#process.stderr.destroy();
    await this.#closed;
  }
}
