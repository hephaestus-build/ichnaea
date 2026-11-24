import { type PairDraw } from "../contracts/block-order.ts";
import { Plan } from "../contracts/records/plan.ts";
import type { TrialIdentity, TrialResult } from "../contracts/records/worker.ts";
export interface RunnerOptions {
    readonly capacity: number;
    readonly deadlineMs: number;
    readonly maxAttempts: number;
}
interface Block {
    readonly block: number;
    readonly plannedBlock: number;
    readonly draws: readonly PairDraw[];
}
interface ClosedBlock extends Block {
    readonly status: "complete" | "abandoned";
}
export interface Attempt {
    readonly trial: TrialIdentity;
    readonly block: number;
    readonly first?: PairDraw["first"];
    readonly started: number;
    readonly deadline: number;
    readonly calls: number;
}
interface Settlement {
    readonly attempt: Attempt;
    readonly calls: number;
    readonly disposition: "record" | "retry" | "timeout" | "protocol" | "budget-exceeded";
}
type Result = Pick<TrialResult, "trial" | "usage" | "failure">;
/** Schedules an already bound analysis. The caller supplies the clock and transports attempts. */
export declare class BlockRunner {
    #private;
    readonly planDigest: string;
    constructor(plan: Plan, options: RunnerOptions);
    get calls(): number;
    startBlock(): Block | undefined;
    dispatch(now: number): Attempt | undefined;
    accept(block: number, result: Result, now: number): Settlement;
    expire(now: number): readonly Settlement[];
    finishBlock(): ClosedBlock;
    abandonBlock(): ClosedBlock;
}
export {};
//# sourceMappingURL=blocks.d.ts.map