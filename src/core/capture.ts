import type { Trial } from "../contracts/records/trial.ts";

/** Capture failures count as missing evidence. */
export const NOT_CAPTURED = "not-captured";

/** A completed trial without captured output is missing evidence. */
export function checkCaptured(trial: Trial): Trial {
  if (trial.outcome !== "completed" || trial.output !== undefined || trial.pointer !== undefined)
    return trial;
  return {
    ...trial,
    outcome: "infrastructure_failure",
    error: { kind: NOT_CAPTURED, message: "the record has no captured output" },
  };
}
