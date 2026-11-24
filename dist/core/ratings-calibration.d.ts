import type { CalibrationInput } from "../calibration/analyze.ts";
import type { RatingsImport } from "../contracts/records/ratings.ts";
import type { Run } from "../contracts/records/run.ts";
/** Checks the run’s binding between the judge identity and the measure it computed. */
export declare function verifyRatingJudge(run: Run, judge: RatingsImport["judge"]): void;
/** Reconstructs the calibrated input from the sidecar's canonical human values. */
export declare function calibrationInput(record: RatingsImport): CalibrationInput;
//# sourceMappingURL=ratings-calibration.d.ts.map