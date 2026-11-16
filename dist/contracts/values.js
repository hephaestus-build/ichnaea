/**
 * What a schema cannot check in a measured value, because it compares two fields: a proportion
 * whose successes exceed its trials. Returns the problem, or undefined when there is none.
 */
export function proportionProblem(value) {
    if (value.type === "proportion" && value.successes > value.trials)
        return `${value.successes} successes of ${value.trials} trials`;
    return undefined;
}
//# sourceMappingURL=values.js.map