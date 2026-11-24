import type { Configuration } from "../contracts/records/configuration.ts";
import { Trial } from "../contracts/records/trial.ts";
import { type TrialRequest, type TrialResult } from "../contracts/records/worker.ts";
interface EvidenceContext {
    readonly run: string;
    readonly block: number;
    readonly first?: "base" | "candidate";
    readonly analysisPlan: string;
    readonly configuration: string;
    readonly settings: string;
    readonly expected?: Configuration;
    readonly requireFullObservations?: boolean;
    readonly artifacts?: Trial["evidence"] | undefined;
    readonly startedAt: string;
    readonly endedAt: string;
    readonly attempts?: Trial["attempts"];
}
/** Converts a correlated worker reply into evidence for the bound trial. */
export declare function workerEvidence(request: TrialRequest, result: TrialResult, context: EvidenceContext): Trial;
export {};
//# sourceMappingURL=runner-evidence.d.ts.map