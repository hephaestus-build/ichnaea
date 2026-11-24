import * as z from "zod";
import { Json } from "../contracts/primitives.ts";
import { TrialIdentity, WorkerReady } from "../contracts/records/worker.ts";
import { type RunRecords } from "./records.ts";
import { type RegistrationReceipt } from "./registration.ts";
type Owner = {
    host: string;
    pid: number;
};
type BlockStart = {
    kind: "block-start";
    block: number;
    first: "base" | "candidate";
};
type Takeover = {
    kind: "owner-takeover";
    previous: Owner;
    cause: "dead-pid" | "expired-lease";
};
type Entry = {
    kind: "run-opened";
} | {
    kind: "receipt";
    receipt: RegistrationReceipt;
} | Takeover | BlockStart | {
    kind: "block-abandoned" | "block-complete";
    block: number;
} | {
    kind: "handshake";
    block: number;
    ready: WorkerReady;
} | {
    kind: "intent";
    block: number;
    trial: TrialIdentity;
} | {
    kind: "outcome";
    block: number;
    trial: TrialIdentity;
    result: Json;
};
type BlockBooking = {
    readonly endpoint: string;
    readonly cap: number;
    readonly calls: number;
};
/** Exclusive access to one work area and its append-only block journal. */
export declare class RunWork {
    #private;
    readonly directory: string;
    private constructor();
    static open(root: string, run: string, receipt?: RegistrationReceipt): Promise<RunWork>;
    receipt(): RegistrationReceipt | undefined;
    entries(): Promise<Entry[]>;
    /** Book the entire block before emitting any attempt intent. A dead runner cannot refund it. */
    startBlock(booking: BlockBooking, draw: (number: number) => BlockStart["first"]): Promise<BlockStart>;
    handshake(ready: WorkerReady): Promise<void>;
    intent(trial: z.input<typeof TrialIdentity>): Promise<void>;
    outcome(trial: z.input<typeof TrialIdentity>, result: z.infer<typeof Json>): Promise<void>;
    completeBlock(): Promise<void>;
    seal(records: RunRecords): Promise<void>;
    close(): Promise<void>;
}
export {};
//# sourceMappingURL=runner-work.d.ts.map