import { canonicalize } from "../contracts/canonical.js";
import { checkCaptured, NOT_CAPTURED } from "./capture.js";
import { measurePin } from "./instrument-pin.js";
/** Outcomes that a measure scores (REQ-20). */
const SCORED = new Set(["completed", "abstained"]);
/** Outcomes that count as a failure on a measure. */
const FAILED = new Set(["system_failure", "budget_exceeded"]);
/**
 * Scores trials with the measures Ichnaea computes. A measure that does not apply to a case
 * gives an explicit not-applicable value, never a zero (REQ-30). A system failure or a budget
 * overrun scores as a failure; infrastructure failures, trials not run and invalid configurations
 * give no value, so they count as missing. A capture failure is never `completed`: import makes a
 * completed record without captured output an infrastructure failure first (`NOT_CAPTURED`), so a
 * measure only ever scores output that was captured.
 */
export function scoreTrials(measures, trials, cases, masks) {
    const values = [];
    for (const measure of measures) {
        if (measure.card.computedBy !== "ichnaea" || !measure.score)
            continue;
        const locked = masks?.[measure.card.id];
        const mask = locked === undefined ? undefined : new Set(locked);
        for (const trial of trials) {
            const c = trial.case === null ? undefined : cases.get(trial.case);
            if (!c)
                continue;
            const base = {
                schema: "ichnaea.measureValue/1",
                trial: trial.id,
                measure: measure.card.id,
                version: measure.card.version,
                source: "ichnaea",
                dataClass: trial.dataClass,
            };
            if (mask ? !mask.has(c.id) : measure.appliesTo && !measure.appliesTo(c)) {
                values.push({ ...base, applicable: false });
                continue;
            }
            if (FAILED.has(trial.outcome)) {
                const value = failureValue(measure, c);
                if (value)
                    values.push({ ...base, applicable: true, value });
                continue;
            }
            if (!SCORED.has(trial.outcome))
                continue;
            const value = measure.score(trial, c);
            if (value !== undefined)
                values.push({ ...base, applicable: true, value });
        }
    }
    return values;
}
function failureValue(measure, c) {
    switch (measure.card.valueType) {
        case "binary":
            return { type: "binary", pass: false };
        case "proportion":
            return { type: "proportion", successes: 0, trials: measure.items?.(c) ?? 1 };
        default:
            // A failed trial has no score on a continuous or ordinal scale: it stays missing.
            return undefined;
    }
}
/** Score the same normalized record shape that the evidence writer sends to the scorer. */
function exampleValue(measure, example) {
    const normalized = checkCaptured(example.trial);
    const value = scoreTrials([measure], [normalized], new Map([[example.case.id, example.case]]))[0];
    return value?.applicable === false ? "not-applicable" : (value?.value ?? "missing");
}
/** Check the fixtures and bind the result to the instrument that ran them. */
export async function testMeasure(measure, options = {}) {
    const failures = [];
    const examples = measure.examples;
    const qualified = Boolean(examples?.nothing?.length && examples?.incomplete?.length);
    const matched = { good: new Set(), bad: new Set() };
    if (!examples?.good.length || !examples.bad.length)
        failures.push(`${measure.card.id}: needs at least one known-good and one known-bad example`);
    if ((examples?.nothing !== undefined || examples?.incomplete !== undefined) && !qualified)
        failures.push(`${measure.card.id}: needs do-nothing and incomplete-capture fixtures`);
    for (const kind of ["good", "bad", "nothing", "incomplete"]) {
        for (const example of examples?.[kind] ?? []) {
            const actual = exampleValue(measure, example);
            const actualJson = canonicalize(actual);
            const expectedJson = canonicalize(example.expected);
            if (actualJson !== expectedJson) {
                failures.push(`${measure.card.id}: ${kind} example '${example.name}' gave ${actualJson}, expected ${expectedJson}`);
                continue;
            }
            if (kind === "incomplete") {
                if (actual !== "missing" ||
                    example.trial.outcome !== "completed" ||
                    checkCaptured(example.trial).error?.kind !== NOT_CAPTURED)
                    failures.push(`${measure.card.id}: incomplete-capture fixture must exercise a completed trial with missing capture`);
                continue;
            }
            if (kind === "nothing") {
                if (!SCORED.has(example.trial.outcome) ||
                    typeof actual === "string" ||
                    actual.type !== measure.card.valueType ||
                    matched.good.has(actualJson) ||
                    (actual.type === "binary" && actual.pass === (measure.card.direction === "higher")))
                    failures.push(`${measure.card.id}: do-nothing fixture needs an observed failing score`);
                continue;
            }
            if (typeof actual === "string" || actual.type !== measure.card.valueType)
                continue;
            const shouldPass = (kind === "good") === (measure.card.direction === "higher");
            if (actual.type === "binary" && actual.pass !== shouldPass)
                continue;
            matched[kind].add(actualJson);
        }
    }
    if (failures.length === 0 &&
        (matched.good.size === 0 ||
            matched.bad.size === 0 ||
            new Set([...matched.good, ...matched.bad]).size < 2))
        failures.push(`${measure.card.id}: needs different scores for known-good and known-bad examples`);
    const digest = await measurePin(measure, options.directory);
    const recorded = measure.card.validation?.tester;
    if (measure.card.computedBy === "ichnaea" && recorded && recorded.digest !== digest)
        failures.push(`${measure.card.id}: tester is stale for this instrument and its fixtures`);
    return {
        status: failures.length === 0 ? "passed" : "failed",
        failures,
        digest,
        ...(qualified && failures.length === 0 ? { qualification: "fixture-qualified" } : {}),
    };
}
//# sourceMappingURL=measures.js.map