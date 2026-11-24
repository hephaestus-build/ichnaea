import type { TrialResult } from "../contracts/records/worker.ts";

export type Capture = Pick<TrialResult, "output" | "pointer" | "artifacts" | "truncated">;

/** A retry can recover absent output, but cannot recover output beyond the capture limit. */
export function captureStatus(result: Capture): "present" | "not-captured" | "truncated" {
  if (result.truncated === true) return "truncated";
  return result.output !== undefined || result.pointer !== undefined || result.artifacts?.length
    ? "present"
    : "not-captured";
}
