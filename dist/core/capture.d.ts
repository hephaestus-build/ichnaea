import type { Trial } from "../contracts/records/trial.ts";
/** Capture failures count as missing evidence. */
export declare const NOT_CAPTURED = "not-captured";
/** A completed trial without captured output is missing evidence. */
export declare function checkCaptured(trial: Trial): Trial;
//# sourceMappingURL=capture.d.ts.map