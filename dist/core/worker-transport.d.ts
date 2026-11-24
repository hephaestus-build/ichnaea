import { type Cancel, type TrialRequest, WorkerReady } from "../contracts/records/worker.ts";
type Frame = {
    readonly kind: "line";
    readonly text: string;
    readonly received: number;
} | {
    readonly kind: "closed";
    readonly reason: string;
} | {
    readonly kind: "timeout";
} | {
    readonly kind: "aborted";
};
/** A local command with a validated trial protocol handshake. */
export declare class CommandWorker {
    #private;
    readonly ready: WorkerReady;
    private constructor();
    static start(argv: readonly string[], timeoutMs: number, diagnostic: (line: string) => void, signal?: AbortSignal): Promise<CommandWorker>;
    next(deadline: number, signal?: AbortSignal): Promise<Frame>;
    send(record: TrialRequest | Cancel): void;
    close(): Promise<void>;
}
export {};
//# sourceMappingURL=worker-transport.d.ts.map