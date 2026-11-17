/** Duplicate keys in a list of records, each named once. */
function duplicates(records, key) {
    const seen = new Set();
    const repeated = new Set();
    for (const r of records) {
        const k = key(r);
        if (seen.has(k))
            repeated.add(k);
        seen.add(k);
    }
    return [...repeated];
}
/**
 * The rules every set of run records keeps: one record per trial, one value per measure and trial,
 * one result per gate. A second record would silently replace the first in any lookup, so it could
 * hide a regression. Returns one message per broken rule.
 */
export function recordProblems(records) {
    const problems = [];
    const trials = duplicates(records.trials, (t) => t.id);
    if (trials.length > 0)
        problems.push(`duplicate trial ID(s): ${trials.join(", ")}`);
    const values = duplicates(records.values, (v) => `${v.measure} on ${v.trial}`);
    if (values.length > 0)
        problems.push(`duplicate measure value(s): ${values.join(", ")}`);
    const gates = duplicates(records.gates, (g) => g.gate);
    if (gates.length > 0)
        problems.push(`duplicate gate result(s): ${gates.join(", ")}`);
    return problems;
}
//# sourceMappingURL=records.js.map