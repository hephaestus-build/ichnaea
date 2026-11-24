import { Json } from "../contracts/primitives.ts";
import { type ObservedConfiguration, TrialRequest, TrialResult } from "../contracts/records/worker.ts";
/** The inputs a worker callback receives, with the arm's role and case references omitted. */
export interface WorkerTrial {
    /** Input, turns and fixtures from the selected case. */
    readonly case: TrialRequest["case"];
    /** The opaque arm's settings, read from the file supplied by the runner. */
    readonly arm: {
        readonly settings: Readonly<Record<string, Json>>;
    };
    /** Directory for the trial's artifacts. */
    readonly workdir: string;
    /** Call limit for this attempt. */
    readonly limits: TrialRequest["limits"];
    /** Aborted when the runner cancels this attempt. */
    readonly signal: AbortSignal;
}
/** The reply from a worker callback. Ichnaea binds it to the request. */
export type WorkerReply = Omit<TrialResult, "schema" | "trial" | "dataClass" | "observed" | "usage"> & {
    readonly observed?: ObservedConfiguration;
    /** Omit only for exactly one accepted call. Report 0 for a local computation with no calls. */
    readonly usage?: TrialResult["usage"];
    readonly dataClass?: TrialResult["dataClass"];
};
/** Serve trial requests on stdin and write protocol records to stdout. Send diagnostics to stderr. */
export declare function serveWorker(handler: (trial: WorkerTrial) => WorkerReply | Promise<WorkerReply>, options?: {
    readonly capacity?: number;
}): Promise<void>;
//# sourceMappingURL=serve-worker.d.ts.map