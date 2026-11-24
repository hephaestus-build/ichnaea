import type { Case } from "../contracts/records/case.ts";
import type { Plan } from "../contracts/records/plan.ts";
import type { Run } from "../contracts/records/run.ts";
import { BlockRunner } from "../run/blocks.ts";
import type { RunWork } from "./runner-work.ts";
import { CommandWorker } from "./worker-transport.ts";
type Prepared = {
    readonly cases: readonly Case[];
    readonly plan: Plan;
};
type Block = NonNullable<ReturnType<BlockRunner["startBlock"]>>;
export declare function runWorkerBlock(input: {
    work: RunWork;
    worker: CommandWorker;
    runner: BlockRunner;
    run: string;
    block: Block;
    prepared: Prepared;
    signal: AbortSignal;
    deadlineMs: number;
}): Promise<"complete" | NonNullable<NonNullable<Run["execution"]>["failure"]>>;
export {};
//# sourceMappingURL=run-worker.d.ts.map