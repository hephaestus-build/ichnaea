import { exactStratifiedTest } from "./exact-conditional.js";
import { scoreDifferenceInterval, scoreDifferenceTest, } from "./score-difference.js";
import { withinCasePermutationTest } from "./randomisation.js";
import { tangoInterval, tangoTest } from "./tango.js";
import { assertCount } from "./types.js";
/** Counts from the 0 and 1 outcomes of an arm's completed trials. */
export function countsFromOutcomes(outcomes) {
    return { successes: outcomes.reduce((a, b) => a + b, 0), trials: outcomes.length };
}
const validity = (limitations) => ({
    validated: limitations.length === 0,
    limitations,
});
/** Thrown when the data cannot support the estimand. The decision then runs estimate-only. */
export class EstimandError extends Error {
    name = "EstimandError";
}
/** The fixed-cases domain the simulation studies cover (VALIDATION.md, decision 0009). */
export const VALIDATED_FIXED_CASES = {
    /** Fewest cases. At 3 and 4 cases with 2 trials, exact coverage dips to 0.9385. */
    minCases: 5,
    /**
     * Most completed trials per case and arm. Suites run 2 or 3, and the search for heterogeneous
     * effects covers 2, 3 and mixed counts, so more than 3 is outside the validated domain.
     */
    maxTrials: 3,
    /** Smallest share of case-arm cells with at least 2 completed trials (missingness studied). */
    minShareWithTwoTrials: 0.9,
};
/**
 * The fixed-cases case selection and lower bound, as `compareCounts` computes them: every case with
 * at least one completed trial in each arm, equal case weights, the stratified Miettinen–Nurminen
 * score interval with the N/(N−1) factor. The simulation studies call this function, so they test
 * the decision path itself. It takes no score options: every other variant is outside the validated
 * domain (a variant without the factor undercovers), so a caller cannot select one here.
 */
export function fixedCasesInterval(cases, level) {
    const strata = cases
        .filter((c) => c.base.trials > 0 && c.candidate.trials > 0)
        .map((c) => ({ candidate: c.candidate, base: c.base }));
    const options = { weights: "equal" };
    return {
        interval: {
            ...scoreDifferenceInterval(strata, level, "lower", options),
            estimand: "fixed-cases",
        },
        strata,
        options,
    };
}
/**
 * Fewest cases for a sampled-cases method. Below it: estimate-only. The method also needs one case
 * per family, so it needs as many families as cases.
 */
export const SAMPLED_CASES_MIN_CASES = 300;
/**
 * Smallest effective non-inferiority margin for the fixed-cases interval: the declared margin minus
 * any safety margin, which is the `margin` that `compareCounts` takes. A placeholder: under
 * heterogeneous effects the lower bound can undercover at small margins, and the floor is not yet
 * established (VALIDATION.md, "The validated domain"). A margin of 0 is not a non-inferiority test.
 */
export const VALIDATED_MARGIN_FLOOR = 0.05;
/**
 * Whether the margin floor is established. Until a reviewed search sets it, every non-inferiority
 * result is not validated, whatever its margin (VALIDATION.md, "The validated domain").
 */
export const VALIDATED_MARGIN_FLOOR_SET = false;
/** The reason every non-inferiority result gives while the floor is not set. */
export const MARGIN_FLOOR_NOT_SET = "the validated margin floor is not set yet";
/**
 * Largest effective non-inferiority margin for the fixed-cases interval. A margin above 30 points
 * says nothing useful about a drop.
 */
export const VALIDATED_MARGIN_CEILING = 0.3;
/**
 * Chooses and runs the paired method for a binary measure. Proportion, score and ordinal measures
 * have no validated method yet (decision 0008) and never reach it.
 *
 * - `fixed-cases`: every completed trial counts. A case with at least one completed trial in each
 *   arm enters the stratified Miettinen–Nurminen score interval and test with equal case weight, so
 *   the estimate is the mean of per-case differences. A case with no completed trial in an arm is
 *   excluded and counted. The regression test is the exact stratified conditional test when every
 *   case and arm has the same number of trials, and a within-case permutation test otherwise.
 * - `sampled-cases`, one trial per case and arm, one case per family, at least 300 cases: Tango's
 *   skewness-corrected score interval. It is experimental, so never validated.
 * - `sampled-cases` otherwise: no method; an EstimandError makes the measure estimate-only.
 */
export function compareCounts(input) {
    if (input.valueType !== "binary")
        throw new EstimandError(`the value type "${input.valueType}" has no validated method yet, so it is estimate-only; only binary outcomes, one per trial, can be compared`);
    if (!(input.margin >= 0 && input.margin < 1))
        throw new RangeError(`margin must be in [0, 1), got ${input.margin}`);
    if (!(input.alpha > 0 && input.alpha < 0.5))
        throw new RangeError(`alpha must be in (0, 0.5), got ${input.alpha}`);
    const level = 1 - input.alpha;
    for (const c of input.cases) {
        assertCount(c.base, `case '${c.id}' base`);
        assertCount(c.candidate, `case '${c.id}' candidate`);
    }
    const ids = new Set(input.cases.map((c) => c.id));
    if (ids.size !== input.cases.length)
        throw new RangeError("case IDs must be unique");
    // A canonical case order, so the result never depends on the order of the input.
    const ordered = input.cases.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const used = ordered.filter((c) => c.base.trials > 0 && c.candidate.trials > 0);
    const excludedCases = ordered.length - used.length;
    if (used.length === 0)
        throw new EstimandError("no case has a completed trial in both arms");
    if (input.estimand === "fixed-cases") {
        const { interval, strata, options } = fixedCasesInterval(used, level);
        const cells = used.flatMap((c) => [c.base.trials, c.candidate.trials]);
        const balanced = new Set(cells).size === 1;
        let regressionTest;
        if (balanced) {
            regressionTest = exactStratifiedTest(strata, "less");
        }
        else {
            if (!input.rng)
                throw new EstimandError("unequal trial counts need a seeded generator for the within-case permutation test");
            regressionTest = withinCasePermutationTest(strata, input.rng);
        }
        const domain = VALIDATED_FIXED_CASES;
        const domainLimitations = [
            ...(used.length < domain.minCases
                ? [`${used.length} case(s); the validated domain starts at ${domain.minCases}`]
                : []),
            ...(excludedCases > 0
                ? [`${excludedCases} case(s) have no completed trial in an arm and are excluded`]
                : []),
            ...(Math.max(...cells) > domain.maxTrials
                ? [`more than ${domain.maxTrials} trials per case and arm is outside the studied grid`]
                : []),
            ...(cells.filter((n) => n >= 2).length < domain.minShareWithTwoTrials * cells.length
                ? [
                    `fewer than ${domain.minShareWithTwoTrials * 100}% of case-arm cells have 2 or more completed trials`,
                ]
                : []),
        ];
        const marginLimitations = [
            ...(VALIDATED_MARGIN_FLOOR_SET ? [] : [MARGIN_FLOOR_NOT_SET]),
            ...(input.margin < VALIDATED_MARGIN_FLOOR
                ? [`margin ${input.margin} is below the validated margin floor ${VALIDATED_MARGIN_FLOOR}`]
                : []),
            ...(input.margin > VALIDATED_MARGIN_CEILING
                ? [
                    `margin ${input.margin} is above the validated margin ceiling ${VALIDATED_MARGIN_CEILING}`,
                ]
                : []),
        ];
        return {
            estimand: input.estimand,
            difference: interval,
            nonInferiorityP: scoreDifferenceTest(strata, -input.margin, "greater", options).p,
            regressionP: regressionTest.p,
            regressionMethod: regressionTest.method,
            usedCases: used.length,
            excludedCases,
            regression: validity(domainLimitations),
            nonInferiority: validity([...domainLimitations, ...marginLimitations]),
        };
    }
    const singleTrials = used.every((c) => c.base.trials === 1 && c.candidate.trials === 1);
    const families = new Set(used.map((c) => c.family ?? c.id));
    if (!singleTrials || families.size !== used.length || used.length < SAMPLED_CASES_MIN_CASES) {
        throw new EstimandError(`sampled-cases needs at least ${SAMPLED_CASES_MIN_CASES} cases, one trial per case and arm and one case per family; this comparison has ${used.length} case(s) in ${families.size} famil${families.size === 1 ? "y" : "ies"}, so it is estimate-only`);
    }
    const table = {
        both: used.filter((c) => c.base.successes === 1 && c.candidate.successes === 1).length,
        candidateOnly: used.filter((c) => c.base.successes === 0 && c.candidate.successes === 1).length,
        baseOnly: used.filter((c) => c.base.successes === 1 && c.candidate.successes === 0).length,
        neither: used.filter((c) => c.base.successes === 0 && c.candidate.successes === 0).length,
    };
    const regressionTest = tangoTest(table, 0, "less", true);
    const experimental = ["Tango's skewness-corrected interval is experimental (VALIDATION.md)"];
    return {
        estimand: input.estimand,
        difference: { ...tangoInterval(table, level, "lower", true), estimand: "sampled-cases" },
        nonInferiorityP: tangoTest(table, -input.margin, "greater", true).p,
        regressionP: regressionTest.p,
        regressionMethod: regressionTest.method,
        usedCases: used.length,
        excludedCases,
        regression: validity(experimental),
        nonInferiority: validity(experimental),
    };
}
//# sourceMappingURL=compare.js.map