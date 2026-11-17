import type { Case } from "../contracts/records/case.ts";
import type { MeasureValue } from "../contracts/records/measure.ts";
import type { Trial } from "../contracts/records/trial.ts";
import type { MeasureDefinition } from "./plugin.ts";
/**
 * Scores trials with the measures Ichnaea computes. A measure that does not apply to a case
 * gives an explicit not-applicable value, never a zero (REQ-30). A system failure or a budget
 * overrun scores as a failure; infrastructure failures, trials not run and invalid configurations
 * give no value, so they count as missing. A capture failure is never `completed`: import makes a
 * completed record without captured output an infrastructure failure first (`NOT_CAPTURED`), so a
 * measure only ever scores output that was captured.
 */
export declare function scoreTrials(measures: readonly MeasureDefinition[], trials: readonly Trial[], cases: ReadonlyMap<string, Case>): MeasureValue[];
/** The result of running a measure's known-good and known-bad examples. */
export interface TesterResult {
    /**
     * `passed` when every example gives its expected value and the measure has both kinds of example.
     */
    readonly status: "passed" | "failed";
    /**
     * One message for each example that failed, or for missing examples; empty when the test passed.
     */
    readonly failures: readonly string[];
    /** The digest of the measure's card and examples that were tested. */
    readonly digest: string;
}
/**
 * Runs a measure against its examples (REQ-33, REQ-121). It fails when a known-good example does
 * not give its expected value, when a known-bad example passes as good, or when the measure has no
 * good and no bad example.
 */
export declare function testMeasure(measure: MeasureDefinition): Promise<TesterResult>;
//# sourceMappingURL=measures.d.ts.map