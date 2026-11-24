import type * as z from "zod";
import { type PairDraw } from "../contracts/block-order.ts";
import type { Case } from "../contracts/records/case.ts";
import { Plan } from "../contracts/records/plan.ts";
import { ExecutedBlock, Run } from "../contracts/records/run.ts";
import { type RunRecords } from "../contracts/run-records.ts";
import type { Host } from "./host.ts";
import type { ImportResult } from "./plugin.ts";
export { NOT_CAPTURED } from "./capture.ts";
/** Thrown when an importer's records cannot be stored. The message names the record. */
export declare class ImportError extends Error {
    /** The error's name, for `instanceof`-free checks. */
    readonly name = "ImportError";
}
type CapturedBlock = Omit<z.input<typeof ExecutedBlock>, "draws"> & {
    readonly draws?: readonly PairDraw[];
};
export interface RecordRunInput {
    readonly host: Host;
    readonly store: {
        createRun(records: RunRecords): Promise<void>;
    };
    readonly plan: Plan;
    readonly cases: readonly Case[];
    readonly result: ImportResult;
    readonly id: string;
    readonly execution: {
        readonly source: "import" | "re-score";
    } | {
        readonly source: "runner";
        readonly blocks: readonly CapturedBlock[];
    };
    readonly producer?: Run["lineage"][number];
    readonly startedAt: string;
    readonly completedAt: string;
}
/** Validate and seal the records that all evidence producers share. */
export declare function recordRun(input: RecordRunInput): Promise<{
    plan: Plan;
    trials: number;
    values: number;
}>;
//# sourceMappingURL=record-run.d.ts.map