/**
 * The verdict labels a card shows, with their symbols. Estimate only is a decision without a
 * verdict. `✓` belongs to Pass alone. A run with no decrease detected is Inconclusive: its
 * sentences say both halves, so the label never reads as reassurance.
 */
export const CARD_LABELS = [
  { label: "Regression", symbol: "✗", verdict: "REGRESSION" },
  { label: "Pass", symbol: "✓", verdict: "PASS" },
  { label: "Inconclusive", symbol: "?", verdict: "INCONCLUSIVE" },
  { label: "Invalid", symbol: "!", verdict: "INVALID" },
  { label: "Estimate only", symbol: "·", verdict: null },
] as const;

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

const run = (
  labels: readonly CardLabel[],
  meaning: string,
  sentences: readonly ReasonSentence[],
  action?: string,
): Reason => ({
  scope: "decision",
  labels,
  meaning,
  sentences,
  ...(action === undefined ? {} : { action }),
});

const always = (key: string, text: string): ReasonSentence => ({ key, when: "always", text });

const JUDGE_LABELS: readonly CardLabel[] = [];

/**
 * Every reason code, in the order the reference documentation lists them. `REASONS` has exactly one
 * entry per code; the compiler checks it.
 */
export const REASON_CODES = [
  "REGRESSION_DETECTED",
  "HARD_CHECK_FAILED",
  "PASS",
  "NO_DECREASE_DETECTED",
  "NON_INFERIORITY_UNVALIDATED",
  "MARGIN_NOT_CLEARED",
  "MARGIN_UNREACHABLE",
  "MISSING_TRIALS_CHANGE_VERDICT",
  "REGRESSION_TEST_UNVALIDATED",
  "INVALID_COVERAGE",
  "INVALID_BUDGET",
  "INVALID_NO_BASE_RESULTS",
  "INVALID_UNDECLARED_CHANGE",
  "INVALID_RECORDS_MISMATCH",
  "INVALID_RECORDS_CONTRADICT",
  "INVALID_HARD_CHECK_MISSING",
  "INVALID_SUITE_SETUP",
  "ESTIMATE_ONLY_SINGLE_TRIAL",
  "ESTIMATE_ONLY_FEW_CASES",
  "ESTIMATE_ONLY_NO_COMPARISON",
  "ESTIMATE_ONLY_NO_PRIMARY",
  "ESTIMATE_ONLY_SAMPLED_CASES",
  "ESTIMATE_ONLY_EXPLORATORY",
  "ESTIMATE_ONLY_CACHED_ARM",
  "ESTIMATE_ONLY_PLACEHOLDER_MARGIN",
  "ESTIMATE_ONLY_NO_METHOD",
  "INTERVAL_UNAVAILABLE_NO_METHOD",
  "INTERVAL_UNAVAILABLE_NO_VALUE",
  "INTERVAL_UNAVAILABLE_DESCRIPTIVE",
  "INTERVAL_UNAVAILABLE_METHOD",
  "JUDGE_ARM_BIAS_WITHIN_BOUND",
  "JUDGE_DIAGNOSTIC",
  "RATERS_BELOW_FLOOR",
  "JUDGE_BELOW_RATERS",
  "ARM_BIAS_NOT_SHOWN_SMALL",
  "ATTENTION_FAILED",
  "PROBE_FAILED",
  "JUDGE_NOT_COVERED",
  "JUDGE_MODEL_NOT_COVERED",
  "SYSTEM_MODEL_NOT_COVERED",
  "ANSWER_LENGTH_OUTSIDE",
  "POPULATION_NOT_COVERED",
  "JUDGE_CALIBRATION_EXPIRED",
  "JUDGE_CHANGED",
  "RUBRIC_CHANGED",
  "INPUTS_CHANGED",
  "AGE_EXPIRED",
] as const;

/** A reason code. Machines read it instead of the English text. */
export type ReasonCode = (typeof REASON_CODES)[number];

/**
 * Every reason code, with its meaning and the card's exact wording. This is the one source of the
 * wording: `report` selects sentences by code and key, and the reference documentation is
 * generated from this list. Every sentence follows the card rules: no unvalidated confidence claim,
 * no "safe", no improvement claim, at most 25 words.
 */
export const REASONS: { readonly [C in ReasonCode]: Reason } = {
  REGRESSION_DETECTED: run(
    ["Regression"],
    "A primary measure decreased beyond run-to-run noise: its regression test rejects, Holm-adjusted across the declared primary measures.",
    [
      {
        key: "noise",
        when: "every case has at least 2 trials each for base and candidate",
        text: "The paired decrease is beyond run-to-run noise ({test}, {p}).",
      },
      {
        key: "single-trial",
        when: "every case has one trial each for base and candidate",
        text: "{broke} {caseNoun} broke and {fixed} got fixed. With no real change, both directions are equally likely. A split this uneven arises by chance with probability {rawP}.",
      },
      {
        key: "single-trial-holm",
        when: "every case has one trial each for base and candidate, and the plan declares more than one primary measure",
        text: "Holm-adjusted across the {m} primary measures: p = {p}.",
      },
      always("margin", "This does not establish that the loss exceeds the {margin}-point limit."),
      {
        key: "unvalidated-margin",
        when: "non-inferiority is not validated, and every case has at least 2 trials each for base and candidate",
        text: "Until the limit check is validated, any decrease beyond run-to-run noise counts as worse.",
      },
    ],
    "Inspect the {changed} changed cases.",
  ),
  HARD_CHECK_FAILED: run(
    ["Regression"],
    "A hard check failed. A hard check is deterministic, so it decides without a statistical test.",
    [
      always(
        "failed",
        'Hard check "{check}" failed on {failures} of {checked} answers. A hard check is exact, so one failure is enough.',
      ),
    ],
    "Inspect the {failures} failing answers.",
  ),
  PASS: run(
    ["Pass"],
    "Every primary measure is non-inferior: its validated one-sided 95% bound lies inside its limit.",
    [
      {
        key: "one-measure",
        when: "the plan has one primary measure",
        text: "With 95% confidence, the average decrease on these cases is at most {bound} points, within the {margin}-point limit.",
      },
      {
        key: "measures",
        when: "the plan has more than one primary measure",
        text: "With 95% confidence, each primary measure’s average decrease on these cases is within its limit.",
      },
      always("scope", "This holds for these {cases} cases. It makes no claim about new inputs."),
      {
        key: "small-decrease",
        when: "a primary measure is non-inferior and its regression test also rejects",
        text: "{measure} changed by {change} points, beyond run-to-run noise, but within its {margin}-point limit.",
      },
    ],
  ),
  NO_DECREASE_DETECTED: run(
    ["Inconclusive"],
    "No primary measure’s validated regression test finds a decrease beyond run-to-run noise, but that is not evidence that no larger decrease exists. The verdict is Inconclusive, and the codes beside it say why it is not a Pass.",
    [
      always(
        "both-halves",
        "No decrease detected. The data cannot rule out a decrease larger than your limit of {margin} points.",
      ),
    ],
  ),
  NON_INFERIORITY_UNVALIDATED: run(
    ["Inconclusive"],
    "A bound clears its limit, but the non-inferiority result is not validated, so no Pass is possible yet.",
    [
      {
        key: "floor",
        when: "the smallest validated limit is not set yet",
        text: "This is not a statistical Pass: this Ichnaea version cannot establish non-inferiority yet.",
      },
      {
        key: "single-trial",
        when: "every case has one trial each for base and candidate",
        text: "This is not a statistical Pass: one trial per case cannot establish non-inferiority yet.",
      },
    ],
  ),
  MARGIN_NOT_CLEARED: run(
    ["Inconclusive"],
    "A primary measure’s bound does not clear its limit, so non-inferiority is not shown.",
    [
      always(
        "not-pass",
        "This is not a statistical Pass: the bound of {measure} does not clear its {margin}-point limit.",
      ),
    ],
  ),
  MARGIN_UNREACHABLE: run(
    ["Inconclusive"],
    "The plan’s best-case bound is above the limit, so even an unchanged candidate cannot reach a Pass. The chance of a Pass at no change is 0%.",
    [
      always(
        "floor",
        "With {cases} cases and {trials} trials each for base and candidate, the best-case bound is {floor} points.",
      ),
      always(
        "consequence",
        "So this suite cannot clear the {margin}-point limit of {measure}, even when nothing changes. Chance of a Pass at no change: 0%.",
      ),
    ],
    "To make a Pass possible for {measure}, add at least {add} cases.",
  ),
  MISSING_TRIALS_CHANGE_VERDICT: run(
    ["Inconclusive"],
    "Imputing the missing trials against the verdict changes it, so no verdict holds. Missing trials are missing, never failures.",
    [
      always(
        "sensitivity",
        "As recorded, the decrease is beyond run-to-run noise ({test}, {p}). If the {missing} missing trials of the {side} {arm} had {imputed}, it would not be ({imputedP}). No verdict holds.",
      ),
      always(
        "missing",
        "Missing trials are not failures: the system gave no answer, so Ichnaea has no result for them.",
      ),
    ],
    "Find out why {missing} trials did not finish, then resume the run.",
  ),
  REGRESSION_TEST_UNVALIDATED: run(
    ["Inconclusive"],
    "A primary measure’s regression test is outside its validated domain, so it can show neither a decrease nor its absence.",
    [always("domain", "The regression test is not validated for this design: {limitation}.")],
  ),
  INVALID_COVERAGE: run(
    ["Invalid"],
    "Too few trials of a primary measure finished. The missing trials are missing, not failed.",
    [
      always(
        "coverage",
        "Only {available} of {planned} trials of {measure} finished for the {side} {arm} ({share}). A decision needs {coverageFloor}.",
      ),
      always(
        "missing",
        "The missing trials are missing, not wrong: {classes}. They say nothing about the change.",
      ),
    ],
    "Check that the system is reachable, then resume the run.",
  ),
  INVALID_BUDGET: run(
    ["Invalid"],
    "The run stopped at its call budget before every trial finished.",
    [
      always(
        "budget",
        "The run stopped at its budget of {calls} calls before every trial finished.",
      ),
    ],
    "Raise the budget in the suite, or run fewer cases.",
  ),
  INVALID_NO_BASE_RESULTS: run(
    ["Invalid"],
    "The base produced no value, so there is nothing to compare.",
    [always("no-base", "The base gave no answers, so there is nothing to compare.")],
    "Check that the base version starts. The full report shows its first error.",
  ),
  INVALID_UNDECLARED_CHANGE: run(
    ["Invalid"],
    "Base and candidate differ in more than the intended change, so a difference cannot be attributed to it.",
    [
      always(
        "factors",
        "Base and candidate differ in more than the intended change: also {factors}.",
      ),
    ],
    "Declare {factors} as part of the intended change, or remove the difference.",
  ),
  INVALID_RECORDS_MISMATCH: run(
    ["Invalid"],
    "The records do not match their plan: a digest differs, or a trial or value is not in the plan.",
    [
      always(
        "mismatch",
        "The records do not match their plan: {detail}. They changed after the run, or the importer wrote them wrong.",
      ),
    ],
    "Run again. If you import, check the importer.",
  ),
  INVALID_RECORDS_CONTRADICT: run(
    ["Invalid"],
    "The records contradict themselves, for example a failed trial with a passing value.",
    [
      always(
        "contradict",
        "{count} trials are marked as failed but carry a passing value. The importer is wrong.",
      ),
    ],
    "Fix the importer, then import again.",
  ),
  INVALID_HARD_CHECK_MISSING: run(
    ["Invalid"],
    "A hard check that the plan requires has no result.",
    [always("missing", 'Hard check "{check}" has no result, so no verdict is possible.')],
    'Check that the suite runs "{check}".',
  ),
  INVALID_SUITE_SETUP: run(
    ["Invalid"],
    "The suite cannot decide as it is set up, for example a placeholder limit in a decision plan.",
    [always("setup", "The suite is not set up to decide: {detail}.")],
    "{fix}",
  ),
  ESTIMATE_ONLY_SINGLE_TRIAL: run(
    ["Estimate only"],
    "Each case has one trial each for base and candidate, and this version decides only from 2 trials per case.",
    [
      always(
        "single-trial",
        "Each case has one trial each for base and candidate, and this Ichnaea version decides from 2.",
      ),
    ],
    "Run with 2 or 3 trials per case to decide.",
  ),
  ESTIMATE_ONLY_FEW_CASES: run(
    ["Estimate only"],
    "Too few cases for the validated method.",
    [always("few", "{cases} cases are too few: the method is validated from 5.")],
    "Add cases.",
  ),
  ESTIMATE_ONLY_NO_COMPARISON: run(
    ["Estimate only"],
    "The run has no base or no candidate, so there is nothing to compare.",
    [always("one-arm", "The run has no base or no candidate, so there is nothing to compare.")],
    "Add a base to the suite.",
  ),
  ESTIMATE_ONLY_NO_PRIMARY: run(
    ["Estimate only"],
    "The suite declares no primary measure.",
    [always("no-primary", "The suite has no primary measure.")],
    "Mark a measure as primary.",
  ),
  ESTIMATE_ONLY_SAMPLED_CASES: run(
    ["Estimate only"],
    "The suite asks about new inputs (sampled cases), and no method for that is validated yet.",
    [
      always(
        "sampled",
        "The suite asks about new inputs like these, and no method for that is validated yet.",
      ),
    ],
    "Use fixed cases to decide.",
  ),
  ESTIMATE_ONLY_EXPLORATORY: run(
    ["Estimate only"],
    "The plan changed after the first trial, so the run is exploratory.",
    [always("exploratory", "The plan changed after the run started, so the run cannot decide.")],
    "Start a new run.",
  ),
  ESTIMATE_ONLY_CACHED_ARM: run(
    ["Estimate only"],
    "The base or the candidate reused cached outputs, so they did not run side by side.",
    [
      always(
        "cached",
        "The base answers came from the cache, so base and candidate did not run side by side.",
      ),
    ],
    "To decide, run base and candidate together.",
  ),
  ESTIMATE_ONLY_PLACEHOLDER_MARGIN: run(
    ["Estimate only"],
    "A primary measure has a placeholder limit, so it gives no verdict.",
    [always("placeholder", "{measure} has no registered limit yet.")],
    "Register a limit for {measure} in the suite.",
  ),
  ESTIMATE_ONLY_NO_METHOD: run(
    ["Estimate only"],
    "No primary measure has a validated method for its kind of value yet, so the run gives no verdict.",
    [
      always(
        "no-method",
        "No method for the {valueType} measures of this suite is validated yet, so they give no verdict.",
      ),
    ],
  ),
  INTERVAL_UNAVAILABLE_NO_METHOD: run(
    [],
    "A change has no interval because no method for its kind of value is validated yet. The record says `interval: unavailable`.",
    [always("no-interval", "No interval yet: no validated method for {valueType} measures.")],
  ),
  INTERVAL_UNAVAILABLE_NO_VALUE: run(
    [],
    "A change has no interval because the base or the candidate has no value to compare. The record says `interval: unavailable`.",
    [always("no-interval", "No interval yet: the base or the candidate has no value to compare.")],
  ),
  INTERVAL_UNAVAILABLE_DESCRIPTIVE: run(
    [],
    "A descriptive change whose comparison gives no interval. The record says `interval: unavailable`.",
    [always("no-interval", "No interval yet: this change is descriptive only.")],
  ),
  INTERVAL_UNAVAILABLE_METHOD: run(
    [],
    "A change whose comparison method gives no interval for these data. The record says `interval: unavailable`.",
    [always("no-interval", "No interval yet: the method for this comparison gives none here.")],
  ),
  JUDGE_ARM_BIAS_WITHIN_BOUND: {
    scope: "judge",
    labels: JUDGE_LABELS,
    meaning:
      "A judge-based measure’s estimated change is within its calibration’s shown bias bound between base and candidate. The verdict does not change.",
    sentences: [
      always(
        "caution",
        "This change is within the judge’s possible bias between base and candidate (at most {shownBound} points, shown on {boundCases} cases). Confirm it with human labels.",
      ),
    ],
  },
  JUDGE_DIAGNOSTIC: {
    scope: "judge",
    labels: JUDGE_LABELS,
    meaning: "The judge’s calibration is diagnostic, so the measure is shown and never decides.",
    sentences: [
      always("status", "{measure} (judge): diagnostic."),
      always("tail", "Until then this measure is shown and never decides."),
    ],
  },
  RATERS_BELOW_FLOOR: {
    scope: "judge",
    labels: JUDGE_LABELS,
    parent: "JUDGE_DIAGNOSTIC",
    meaning: "The raters agree too little with each other to calibrate a judge against.",
    sentences: [
      always(
        "condition",
        "The raters agree only {humanHuman} with each other, under the {minimum} needed to calibrate against.",
      ),
    ],
    action: "Sharpen the rubric, then label again.",
  },
  JUDGE_BELOW_RATERS: {
    scope: "judge",
    labels: JUDGE_LABELS,
    parent: "JUDGE_DIAGNOSTIC",
    meaning: "The judge agrees with the raters less than they agree with each other.",
    sentences: [
      always(
        "condition",
        "The judge agrees with the raters less than they agree with each other. The one-sided 95% bound of the gap is {gap}, beyond the {tolerance} allowed.",
      ),
    ],
    action:
      "Change the judge’s prompt or model, then re-judge the calibration set. No new labels are needed.",
  },
  ARM_BIAS_NOT_SHOWN_SMALL: {
    scope: "judge",
    labels: JUDGE_LABELS,
    parent: "JUDGE_DIAGNOSTIC",
    meaning:
      "The calibration does not show that the judge’s bias between base and candidate is small.",
    sentences: [
      always(
        "condition",
        "The judge’s bias between base and candidate is not shown to be small: it may reach {shownBound} points, beyond the {limit}-point limit.",
      ),
      {
        key: "reachable",
        when: "the calibration record plans a number of cases that could show the bias small",
        text: "About {casesNeeded} cases could show it small.",
      },
      {
        key: "not-reachable",
        when: "the estimated bias itself exceeds the limit",
        text: "The estimated bias itself exceeds the limit, so more cases will not show it small.",
      },
    ],
    action: "Label more cases, or change the judge if more cases cannot show it.",
  },
  ATTENTION_FAILED: {
    scope: "judge",
    labels: JUDGE_LABELS,
    parent: "JUDGE_DIAGNOSTIC",
    meaning: "A rater failed the attention checks, so the study is incomplete.",
    sentences: [
      always(
        "condition",
        "Rater {pseudonym} failed the attention checks, so the study is incomplete.",
      ),
    ],
    action: "Replace the rater, then finish the study.",
  },
  PROBE_FAILED: {
    scope: "judge",
    labels: JUDGE_LABELS,
    parent: "JUDGE_DIAGNOSTIC",
    meaning: "The judge gave an unexpected verdict on a probe answer.",
    sentences: [
      always("condition", "The judge gave an unexpected verdict on {probes} probe answers."),
    ],
    action: "Fix the judge, then re-judge the calibration set.",
  },
  JUDGE_NOT_COVERED: {
    scope: "judge",
    labels: JUDGE_LABELS,
    meaning:
      "This run is outside what the judge’s calibration covers, so the measure does not decide in it.",
    sentences: [always("status", "{measure} (judge): not used to decide in this run.")],
  },
  JUDGE_MODEL_NOT_COVERED: {
    scope: "judge",
    labels: JUDGE_LABELS,
    parent: "JUDGE_NOT_COVERED",
    meaning: "The judge answered as a model that the calibration does not cover.",
    sentences: [
      always("reason", "The judge answered as {observed}. It was calibrated as {covered}."),
    ],
    action: "Re-judge the calibration set with {observed}. No new labels are needed.",
  },
  SYSTEM_MODEL_NOT_COVERED: {
    scope: "judge",
    labels: JUDGE_LABELS,
    parent: "JUDGE_NOT_COVERED",
    meaning:
      "The base or the candidate uses a system model whose answers the calibration does not cover.",
    sentences: [
      always("reason", "The calibration covers only answers from {covered}, not from {model}."),
    ],
    action:
      "Label the answers from {model} on the same {calibrationCases} cases, about {hours} h for each rater.",
  },
  ANSWER_LENGTH_OUTSIDE: {
    scope: "judge",
    labels: JUDGE_LABELS,
    parent: "JUDGE_NOT_COVERED",
    meaning:
      "The candidate’s median answer length is outside the 5th to 95th percentile of the calibration answers.",
    sentences: [
      always(
        "reason",
        "The candidate’s median answer is {median} characters long, outside the calibrated range of {p5} to {p95}.",
      ),
    ],
    action:
      "Label the candidate’s answers, or confirm that the length change is intended and run a new study.",
  },
  POPULATION_NOT_COVERED: {
    scope: "judge",
    labels: JUDGE_LABELS,
    parent: "JUDGE_NOT_COVERED",
    meaning: "The judge was calibrated on another suite or case set.",
    sentences: [always("reason", "The judge was calibrated on another suite or case set.")],
    action: "Run a calibration study on this suite.",
  },
  JUDGE_CALIBRATION_EXPIRED: {
    scope: "judge",
    labels: JUDGE_LABELS,
    meaning: "The judge’s calibration expired, so the measure does not decide.",
    sentences: [
      always("status", "{measure} (judge): calibration expired, so this measure does not decide."),
    ],
  },
  JUDGE_CHANGED: {
    scope: "judge",
    labels: JUDGE_LABELS,
    parent: "JUDGE_CALIBRATION_EXPIRED",
    meaning: "The judge record changed after calibration.",
    sentences: [always("reason", "The judge changed after calibration.")],
    action: "Re-judge the calibration set. No new labels are needed.",
  },
  RUBRIC_CHANGED: {
    scope: "judge",
    labels: JUDGE_LABELS,
    parent: "JUDGE_CALIBRATION_EXPIRED",
    meaning: "The rubric changed after calibration.",
    sentences: [always("reason", "The rubric changed after calibration.")],
    action: "Run a new study.",
  },
  INPUTS_CHANGED: {
    scope: "judge",
    labels: JUDGE_LABELS,
    parent: "JUDGE_CALIBRATION_EXPIRED",
    meaning: "The fields the judge and the raters read changed after calibration.",
    sentences: [always("reason", "The fields the judge reads changed after calibration.")],
    action: "Run a new study: the raters saw the old fields.",
  },
  AGE_EXPIRED: {
    scope: "judge",
    labels: JUDGE_LABELS,
    parent: "JUDGE_CALIBRATION_EXPIRED",
    meaning: "The calibration passed its age limit.",
    sentences: [always("reason", "The calibration expired on {expiresAt}.")],
    action: "Draw a new sample and label it.",
  },
};

/**
 * The slots that `report` fills from the decision and the suite for any reason: the measure, its
 * margin and change, the case and trial counts, and the test result. `side` is "base" or
 * "candidate": `report` reads it from the decision's role for the reason's `arm` parameter, because
 * an arm name is opaque and never says its side. Every other slot of a reason is one of its own
 * parameters (`ReasonParams`).
 */
export const CONTEXT_SLOTS = [
  "measure",
  "margin",
  "change",
  "bound",
  "cases",
  "caseNoun",
  "trials",
  "changed",
  "broke",
  "fixed",
  "test",
  "p",
  "rawP",
  "m",
  "side",
] as const;

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
  MARGIN_UNREACHABLE: { readonly floor: number; readonly add: number };
  /** The parameters of `MISSING_TRIALS_CHANGE_VERDICT`. */
  MISSING_TRIALS_CHANGE_VERDICT: {
    readonly missing: number;
    readonly arm: string;
    readonly imputed: "passed" | "failed";
    readonly imputedP: number;
  };
  /** The parameters of `REGRESSION_TEST_UNVALIDATED`. */
  REGRESSION_TEST_UNVALIDATED: { readonly limitation: string };
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
  INVALID_BUDGET: { readonly calls: number };
  /** The parameters of `INVALID_NO_BASE_RESULTS`. */
  INVALID_NO_BASE_RESULTS: NoParams;
  /** The parameters of `INVALID_UNDECLARED_CHANGE`. */
  INVALID_UNDECLARED_CHANGE: { readonly factors: readonly string[] };
  /** The parameters of `INVALID_RECORDS_MISMATCH`. */
  INVALID_RECORDS_MISMATCH: { readonly detail: string };
  /** The parameters of `INVALID_RECORDS_CONTRADICT`. */
  INVALID_RECORDS_CONTRADICT: { readonly count: number };
  /** The parameters of `INVALID_HARD_CHECK_MISSING`. */
  INVALID_HARD_CHECK_MISSING: { readonly check: string };
  /** The parameters of `INVALID_SUITE_SETUP`. */
  INVALID_SUITE_SETUP: { readonly detail: string; readonly fix: string };
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
  ESTIMATE_ONLY_NO_METHOD: { readonly valueType: string };
  /** The parameters of `INTERVAL_UNAVAILABLE_NO_METHOD`. */
  INTERVAL_UNAVAILABLE_NO_METHOD: { readonly valueType: string };
  /** The parameters of `INTERVAL_UNAVAILABLE_NO_VALUE`. */
  INTERVAL_UNAVAILABLE_NO_VALUE: NoParams;
  /** The parameters of `INTERVAL_UNAVAILABLE_DESCRIPTIVE`. */
  INTERVAL_UNAVAILABLE_DESCRIPTIVE: NoParams;
  /** The parameters of `INTERVAL_UNAVAILABLE_METHOD`. */
  INTERVAL_UNAVAILABLE_METHOD: NoParams;
  /** The parameters of `JUDGE_ARM_BIAS_WITHIN_BOUND`. */
  JUDGE_ARM_BIAS_WITHIN_BOUND: { readonly shownBound: number; readonly boundCases: number };
  /** The parameters of `JUDGE_DIAGNOSTIC`. */
  JUDGE_DIAGNOSTIC: NoParams;
  /** The parameters of `RATERS_BELOW_FLOOR`. */
  RATERS_BELOW_FLOOR: { readonly humanHuman: number; readonly minimum: number };
  /** The parameters of `JUDGE_BELOW_RATERS`. */
  JUDGE_BELOW_RATERS: { readonly gap: number; readonly tolerance: number };
  /** The parameters of `ARM_BIAS_NOT_SHOWN_SMALL`. */
  ARM_BIAS_NOT_SHOWN_SMALL: {
    readonly shownBound: number;
    readonly limit: number;
    readonly casesNeeded: number | "not reachable";
  };
  /** The parameters of `ATTENTION_FAILED`. */
  ATTENTION_FAILED: { readonly pseudonym: string };
  /** The parameters of `PROBE_FAILED`. */
  PROBE_FAILED: { readonly probes: number };
  /** The parameters of `JUDGE_NOT_COVERED`. */
  JUDGE_NOT_COVERED: NoParams;
  /** The parameters of `JUDGE_MODEL_NOT_COVERED`. */
  JUDGE_MODEL_NOT_COVERED: { readonly observed: string; readonly covered: readonly string[] };
  /** The parameters of `SYSTEM_MODEL_NOT_COVERED`. */
  SYSTEM_MODEL_NOT_COVERED: {
    readonly model: string;
    readonly covered: readonly string[];
    readonly calibrationCases: number;
    readonly hours: number;
  };
  /** The parameters of `ANSWER_LENGTH_OUTSIDE`. */
  ANSWER_LENGTH_OUTSIDE: { readonly median: number; readonly p5: number; readonly p95: number };
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
  AGE_EXPIRED: { readonly expiresAt: string };
}

/** The parameter names of each reason, as values, so a test can match them to the templates. */
export const REASON_PARAMS: {
  readonly [C in ReasonCode]: ReadonlyArray<keyof ReasonParams[C] & string>;
} = {
  REGRESSION_DETECTED: [],
  HARD_CHECK_FAILED: ["check", "failures", "checked"],
  PASS: [],
  NO_DECREASE_DETECTED: [],
  NON_INFERIORITY_UNVALIDATED: [],
  MARGIN_NOT_CLEARED: [],
  MARGIN_UNREACHABLE: ["floor", "add"],
  MISSING_TRIALS_CHANGE_VERDICT: ["missing", "arm", "imputed", "imputedP"],
  REGRESSION_TEST_UNVALIDATED: ["limitation"],
  INVALID_COVERAGE: ["available", "planned", "arm", "share", "coverageFloor", "classes"],
  INVALID_BUDGET: ["calls"],
  INVALID_NO_BASE_RESULTS: [],
  INVALID_UNDECLARED_CHANGE: ["factors"],
  INVALID_RECORDS_MISMATCH: ["detail"],
  INVALID_RECORDS_CONTRADICT: ["count"],
  INVALID_HARD_CHECK_MISSING: ["check"],
  INVALID_SUITE_SETUP: ["detail", "fix"],
  ESTIMATE_ONLY_SINGLE_TRIAL: [],
  ESTIMATE_ONLY_FEW_CASES: [],
  ESTIMATE_ONLY_NO_COMPARISON: [],
  ESTIMATE_ONLY_NO_PRIMARY: [],
  ESTIMATE_ONLY_SAMPLED_CASES: [],
  ESTIMATE_ONLY_EXPLORATORY: [],
  ESTIMATE_ONLY_CACHED_ARM: [],
  ESTIMATE_ONLY_PLACEHOLDER_MARGIN: [],
  ESTIMATE_ONLY_NO_METHOD: ["valueType"],
  INTERVAL_UNAVAILABLE_NO_METHOD: ["valueType"],
  INTERVAL_UNAVAILABLE_NO_VALUE: [],
  INTERVAL_UNAVAILABLE_DESCRIPTIVE: [],
  INTERVAL_UNAVAILABLE_METHOD: [],
  JUDGE_ARM_BIAS_WITHIN_BOUND: ["shownBound", "boundCases"],
  JUDGE_DIAGNOSTIC: [],
  RATERS_BELOW_FLOOR: ["humanHuman", "minimum"],
  JUDGE_BELOW_RATERS: ["gap", "tolerance"],
  ARM_BIAS_NOT_SHOWN_SMALL: ["shownBound", "limit", "casesNeeded"],
  ATTENTION_FAILED: ["pseudonym"],
  PROBE_FAILED: ["probes"],
  JUDGE_NOT_COVERED: [],
  JUDGE_MODEL_NOT_COVERED: ["observed", "covered"],
  SYSTEM_MODEL_NOT_COVERED: ["model", "covered", "calibrationCases", "hours"],
  ANSWER_LENGTH_OUTSIDE: ["median", "p5", "p95"],
  POPULATION_NOT_COVERED: [],
  JUDGE_CALIBRATION_EXPIRED: [],
  JUDGE_CHANGED: [],
  RUBRIC_CHANGED: [],
  INPUTS_CHANGED: [],
  AGE_EXPIRED: ["expiresAt"],
};

/** A reason as a producer emits it: the code with its parameters, checked by the compiler. */
export type ReasonInstance = {
  readonly [C in ReasonCode]: { readonly code: C; readonly params: ReasonParams[C] };
}[ReasonCode];

/** The reason with the given code, or `undefined` for a string that is not a code. */
export function reasonFor(code: string): Reason | undefined {
  return (REASON_CODES as readonly string[]).includes(code)
    ? REASONS[code as ReasonCode]
    : undefined;
}
