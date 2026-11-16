/**
 * The verdict labels a card shows, with their symbols. A label refines the decision's verdict: NO
 * DECREASE DETECTED and INCONCLUSIVE are both an INCONCLUSIVE decision, and ESTIMATE ONLY is a
 * decision without a verdict. `✓` belongs to PASS alone.
 */
export declare const CARD_LABELS: readonly [{
    readonly label: "REGRESSION";
    readonly symbol: "✗";
    readonly verdict: "REGRESSION";
}, {
    readonly label: "PASS";
    readonly symbol: "✓";
    readonly verdict: "PASS";
}, {
    readonly label: "NO DECREASE DETECTED";
    readonly symbol: "○";
    readonly verdict: "INCONCLUSIVE";
}, {
    readonly label: "INCONCLUSIVE";
    readonly symbol: "?";
    readonly verdict: "INCONCLUSIVE";
}, {
    readonly label: "INVALID";
    readonly symbol: "!";
    readonly verdict: "INVALID";
}, {
    readonly label: "ESTIMATE ONLY";
    readonly symbol: "·";
    readonly verdict: null;
}];
/** A verdict label that a card shows. */
export type CardLabel = (typeof CARD_LABELS)[number]["label"];
/**
 * Where a reason applies: the decision (the run, or one measure of it), or one judge-based measure
 * and its calibration.
 */
export type ReasonScope = "decision" | "judge";
/** One sentence of a card for a reason, and when the card shows it. */
export interface ReasonSentence {
    /** The stable key that `report` selects the sentence by. */
    readonly key: string;
    /** When the card shows the sentence, in words, for the reference documentation. */
    readonly when: string;
    /** The sentence. `{name}` marks a slot that `report` fills from the decision. */
    readonly text: string;
}
/** A reason code with its meaning and the card's exact wording. */
export interface Reason {
    /** Where the reason applies. */
    readonly scope: ReasonScope;
    /** The card labels this reason appears with. Empty when it can appear with any label. */
    readonly labels: readonly CardLabel[];
    /** For a detailed reason, the code it details, for example a judge status. */
    readonly parent?: ReasonCode;
    /** What the reason means, for the reference documentation. */
    readonly meaning: string;
    /** The card's sentences for this reason, in the order the card shows them. */
    readonly sentences: readonly ReasonSentence[];
    /** The next step the card names, when the reason has one. */
    readonly action?: string;
}
/**
 * Every reason code, in the order the reference documentation lists them. `REASONS` has exactly one
 * entry per code; the compiler checks it.
 */
export declare const REASON_CODES: readonly ["REGRESSION_DETECTED", "HARD_CHECK_FAILED", "PASS", "NO_DECREASE_DETECTED", "NON_INFERIORITY_UNVALIDATED", "MARGIN_NOT_CLEARED", "MARGIN_UNREACHABLE", "MISSING_TRIALS_CHANGE_VERDICT", "REGRESSION_TEST_UNVALIDATED", "INVALID_COVERAGE", "INVALID_BUDGET", "INVALID_NO_BASE_RESULTS", "INVALID_UNDECLARED_CHANGE", "INVALID_RECORDS_MISMATCH", "INVALID_RECORDS_CONTRADICT", "INVALID_HARD_CHECK_MISSING", "INVALID_SUITE_SETUP", "ESTIMATE_ONLY_SINGLE_TRIAL", "ESTIMATE_ONLY_FEW_CASES", "ESTIMATE_ONLY_NO_COMPARISON", "ESTIMATE_ONLY_NO_PRIMARY", "ESTIMATE_ONLY_SAMPLED_CASES", "ESTIMATE_ONLY_EXPLORATORY", "ESTIMATE_ONLY_CACHED_ARM", "ESTIMATE_ONLY_PLACEHOLDER_MARGIN", "ESTIMATE_ONLY_NO_METHOD", "INTERVAL_UNAVAILABLE_NO_METHOD", "INTERVAL_UNAVAILABLE_NO_VALUE", "INTERVAL_UNAVAILABLE_DESCRIPTIVE", "INTERVAL_UNAVAILABLE_METHOD", "JUDGE_ARM_BIAS_WITHIN_BOUND", "JUDGE_DIAGNOSTIC", "RATERS_BELOW_FLOOR", "JUDGE_BELOW_RATERS", "ARM_BIAS_NOT_SHOWN_SMALL", "ATTENTION_FAILED", "PROBE_FAILED", "JUDGE_NOT_COVERED", "JUDGE_MODEL_NOT_COVERED", "SYSTEM_MODEL_NOT_COVERED", "ANSWER_LENGTH_OUTSIDE", "POPULATION_NOT_COVERED", "JUDGE_CALIBRATION_EXPIRED", "JUDGE_CHANGED", "RUBRIC_CHANGED", "INPUTS_CHANGED", "AGE_EXPIRED"];
/** A reason code. Machines read it instead of the English text. */
export type ReasonCode = (typeof REASON_CODES)[number];
/**
 * Every reason code, with its meaning and the card's exact wording. This is the one source of the
 * wording: `report` selects sentences by code and key, and the reference documentation is
 * generated from this list. Every sentence follows the card rules: no unvalidated confidence claim,
 * no "safe", no improvement claim, at most 25 words.
 */
export declare const REASONS: {
    readonly [C in ReasonCode]: Reason;
};
/**
 * The slots that `report` fills from the decision and the suite for any reason: the measure, its
 * margin and change, the case and trial counts, and the test result. Every other slot of a reason
 * is one of its own parameters (`ReasonParams`).
 */
export declare const CONTEXT_SLOTS: readonly ["measure", "margin", "change", "bound", "cases", "caseNoun", "trials", "changed", "broke", "fixed", "test", "p", "rawP", "m"];
/** A slot that `report` fills from the decision and the suite. */
export type ContextSlot = (typeof CONTEXT_SLOTS)[number];
/** A reason without parameters of its own. */
export type NoParams = Readonly<Record<never, never>>;
/**
 * The parameters each reason carries, by code: the facts its sentences need beyond the context
 * slots. A producer that emits a reason must give these, so no card line misses a slot. Numbers
 * are raw (a share or a bound in [0, 1], a count, a p-value); `report` formats them.
 */
export interface ReasonParams {
    /** The parameters of `REGRESSION_DETECTED`. */
    REGRESSION_DETECTED: NoParams;
    /** The parameters of `HARD_CHECK_FAILED`. */
    HARD_CHECK_FAILED: {
        readonly check: string;
        readonly failures: number;
        readonly checked: number;
    };
    /** The parameters of `PASS`. */
    PASS: NoParams;
    /** The parameters of `NO_DECREASE_DETECTED`. */
    NO_DECREASE_DETECTED: NoParams;
    /** The parameters of `NON_INFERIORITY_UNVALIDATED`. */
    NON_INFERIORITY_UNVALIDATED: NoParams;
    /** The parameters of `MARGIN_NOT_CLEARED`. */
    MARGIN_NOT_CLEARED: NoParams;
    /** The parameters of `MARGIN_UNREACHABLE`. */
    MARGIN_UNREACHABLE: {
        readonly floor: number;
        readonly add: number;
    };
    /** The parameters of `MISSING_TRIALS_CHANGE_VERDICT`. */
    MISSING_TRIALS_CHANGE_VERDICT: {
        readonly missing: number;
        readonly arm: string;
        readonly imputed: "passed" | "failed";
        readonly imputedP: number;
    };
    /** The parameters of `REGRESSION_TEST_UNVALIDATED`. */
    REGRESSION_TEST_UNVALIDATED: {
        readonly limitation: string;
    };
    /** The parameters of `INVALID_COVERAGE`. */
    INVALID_COVERAGE: {
        readonly available: number;
        readonly planned: number;
        readonly arm: string;
        readonly share: number;
        readonly coverageFloor: number;
        readonly classes: string;
    };
    /** The parameters of `INVALID_BUDGET`. */
    INVALID_BUDGET: {
        readonly calls: number;
    };
    /** The parameters of `INVALID_NO_BASE_RESULTS`. */
    INVALID_NO_BASE_RESULTS: NoParams;
    /** The parameters of `INVALID_UNDECLARED_CHANGE`. */
    INVALID_UNDECLARED_CHANGE: {
        readonly factors: readonly string[];
    };
    /** The parameters of `INVALID_RECORDS_MISMATCH`. */
    INVALID_RECORDS_MISMATCH: {
        readonly detail: string;
    };
    /** The parameters of `INVALID_RECORDS_CONTRADICT`. */
    INVALID_RECORDS_CONTRADICT: {
        readonly count: number;
    };
    /** The parameters of `INVALID_HARD_CHECK_MISSING`. */
    INVALID_HARD_CHECK_MISSING: {
        readonly check: string;
    };
    /** The parameters of `INVALID_SUITE_SETUP`. */
    INVALID_SUITE_SETUP: {
        readonly detail: string;
        readonly fix: string;
    };
    /** The parameters of `ESTIMATE_ONLY_SINGLE_TRIAL`. */
    ESTIMATE_ONLY_SINGLE_TRIAL: NoParams;
    /** The parameters of `ESTIMATE_ONLY_FEW_CASES`. */
    ESTIMATE_ONLY_FEW_CASES: NoParams;
    /** The parameters of `ESTIMATE_ONLY_NO_COMPARISON`. */
    ESTIMATE_ONLY_NO_COMPARISON: NoParams;
    /** The parameters of `ESTIMATE_ONLY_NO_PRIMARY`. */
    ESTIMATE_ONLY_NO_PRIMARY: NoParams;
    /** The parameters of `ESTIMATE_ONLY_SAMPLED_CASES`. */
    ESTIMATE_ONLY_SAMPLED_CASES: NoParams;
    /** The parameters of `ESTIMATE_ONLY_EXPLORATORY`. */
    ESTIMATE_ONLY_EXPLORATORY: NoParams;
    /** The parameters of `ESTIMATE_ONLY_CACHED_ARM`. */
    ESTIMATE_ONLY_CACHED_ARM: NoParams;
    /** The parameters of `ESTIMATE_ONLY_PLACEHOLDER_MARGIN`. */
    ESTIMATE_ONLY_PLACEHOLDER_MARGIN: NoParams;
    /** The parameters of `ESTIMATE_ONLY_NO_METHOD`. */
    ESTIMATE_ONLY_NO_METHOD: {
        readonly valueType: string;
    };
    /** The parameters of `INTERVAL_UNAVAILABLE_NO_METHOD`. */
    INTERVAL_UNAVAILABLE_NO_METHOD: {
        readonly valueType: string;
    };
    /** The parameters of `INTERVAL_UNAVAILABLE_NO_VALUE`. */
    INTERVAL_UNAVAILABLE_NO_VALUE: NoParams;
    /** The parameters of `INTERVAL_UNAVAILABLE_DESCRIPTIVE`. */
    INTERVAL_UNAVAILABLE_DESCRIPTIVE: NoParams;
    /** The parameters of `INTERVAL_UNAVAILABLE_METHOD`. */
    INTERVAL_UNAVAILABLE_METHOD: NoParams;
    /** The parameters of `JUDGE_ARM_BIAS_WITHIN_BOUND`. */
    JUDGE_ARM_BIAS_WITHIN_BOUND: {
        readonly shownBound: number;
        readonly boundCases: number;
    };
    /** The parameters of `JUDGE_DIAGNOSTIC`. */
    JUDGE_DIAGNOSTIC: NoParams;
    /** The parameters of `RATERS_BELOW_FLOOR`. */
    RATERS_BELOW_FLOOR: {
        readonly humanHuman: number;
        readonly minimum: number;
    };
    /** The parameters of `JUDGE_BELOW_RATERS`. */
    JUDGE_BELOW_RATERS: {
        readonly gap: number;
        readonly tolerance: number;
    };
    /** The parameters of `ARM_BIAS_NOT_SHOWN_SMALL`. */
    ARM_BIAS_NOT_SHOWN_SMALL: {
        readonly shownBound: number;
        readonly limit: number;
        readonly casesNeeded: number | "not reachable";
    };
    /** The parameters of `ATTENTION_FAILED`. */
    ATTENTION_FAILED: {
        readonly pseudonym: string;
    };
    /** The parameters of `PROBE_FAILED`. */
    PROBE_FAILED: {
        readonly probes: number;
    };
    /** The parameters of `JUDGE_NOT_COVERED`. */
    JUDGE_NOT_COVERED: NoParams;
    /** The parameters of `JUDGE_MODEL_NOT_COVERED`. */
    JUDGE_MODEL_NOT_COVERED: {
        readonly observed: string;
        readonly covered: readonly string[];
    };
    /** The parameters of `SYSTEM_MODEL_NOT_COVERED`. */
    SYSTEM_MODEL_NOT_COVERED: {
        readonly model: string;
        readonly covered: readonly string[];
        readonly calibrationCases: number;
        readonly hours: number;
    };
    /** The parameters of `ANSWER_LENGTH_OUTSIDE`. */
    ANSWER_LENGTH_OUTSIDE: {
        readonly median: number;
        readonly p5: number;
        readonly p95: number;
    };
    /** The parameters of `POPULATION_NOT_COVERED`. */
    POPULATION_NOT_COVERED: NoParams;
    /** The parameters of `JUDGE_CALIBRATION_EXPIRED`. */
    JUDGE_CALIBRATION_EXPIRED: NoParams;
    /** The parameters of `JUDGE_CHANGED`. */
    JUDGE_CHANGED: NoParams;
    /** The parameters of `RUBRIC_CHANGED`. */
    RUBRIC_CHANGED: NoParams;
    /** The parameters of `INPUTS_CHANGED`. */
    INPUTS_CHANGED: NoParams;
    /** The parameters of `AGE_EXPIRED`. */
    AGE_EXPIRED: {
        readonly expiresAt: string;
    };
}
/** The parameter names of each reason, as values, so a test can match them to the templates. */
export declare const REASON_PARAMS: {
    readonly [C in ReasonCode]: ReadonlyArray<keyof ReasonParams[C] & string>;
};
/** A reason as a producer emits it: the code with its parameters, checked by the compiler. */
export type ReasonInstance = {
    readonly [C in ReasonCode]: {
        readonly code: C;
        readonly params: ReasonParams[C];
    };
}[ReasonCode];
/** The reason with the given code, or `undefined` for a string that is not a code. */
export declare function reasonFor(code: string): Reason | undefined;
//# sourceMappingURL=reasons.d.ts.map