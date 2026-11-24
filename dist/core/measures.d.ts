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
export declare function scoreTrials(measures: readonly MeasureDefinition[], trials: readonly Trial[], cases: ReadonlyMap<string, Case>, masks?: Readonly<Record<string, readonly string[]>>): MeasureValue[];
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
    /** Issued after all four fixture groups pass. */
    readonly qualification?: "fixture-qualified";
    /** The instrument and fixture digest that this result tested. */
    readonly digest: string;
}
/** Check the fixtures and bind the result to the instrument that ran them. */
export declare function testMeasure(measure: MeasureDefinition, options?: {
    readonly directory?: string;
}): Promise<TesterResult>;
//# sourceMappingURL=measures.d.ts.map