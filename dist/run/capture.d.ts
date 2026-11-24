import type { TrialResult } from "../contracts/records/worker.ts";
export type Capture = Pick<TrialResult, "output" | "pointer" | "artifacts" | "truncated">;
/** A retry can recover absent output, but cannot recover output beyond the capture limit. */
export declare function captureStatus(result: Capture): "present" | "not-captured" | "truncated";
//# sourceMappingURL=capture.d.ts.map