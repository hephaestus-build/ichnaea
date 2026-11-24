import type { Decision } from "../contracts/records/decision.ts";
import type { RunManifest } from "../contracts/run-manifest.ts";
import type { RunRecords } from "../contracts/run-records.ts";
import type { DecisionRecords } from "./recompute.ts";
/** Use canonical record digests so formatting does not affect replay identity. */
export declare function runManifest(records: RunRecords, decision: Decision, aa?: DecisionRecords["aa"]): RunManifest;
/** The version and input identity of a later calculation. */
export interface Recalculation {
    readonly schema: "ichnaea.recalculation/1";
    readonly identity: string;
    readonly manifest: string;
    readonly decision: Decision;
}
/** A later calculation has a reproducible identity and retains its original manifest. */
export declare function recalculation(manifest: RunManifest, decision: Decision): Recalculation;
//# sourceMappingURL=manifest.d.ts.map