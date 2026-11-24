import type { Plan } from "../contracts/records/plan.ts";
import type { Run } from "../contracts/records/run.ts";
import type { Trial } from "../contracts/records/trial.ts";
export interface AssignedPair {
    readonly case: string;
    readonly block: number;
    readonly group: number;
    readonly base: string;
    readonly candidate: string;
}
interface Admitted {
    readonly status: "admitted";
    readonly planned: number;
    readonly observed: number;
    readonly effective: number;
    readonly pairs: readonly AssignedPair[];
    readonly excluded: ReadonlySet<string>;
}
interface Refused {
    readonly status: "refused";
    readonly reason: "EXECUTION_UNRECORDED" | "ARMS_NOT_INTERLEAVED" | "ESTIMATE_ONLY_EXPLORATORY" | "ESTIMATE_ONLY_NO_METHOD";
    readonly detail: string;
}
export type BlockAdmission = Admitted | Refused;
/** Admit only the locked pair draws of completed blocks and verify their recorded start ranks. */
export declare function admitBlocks(plan: Plan, run: Run, trials: readonly Trial[]): BlockAdmission;
export {};
//# sourceMappingURL=blocks.d.ts.map