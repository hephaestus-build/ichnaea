/**
 * Holm's step-down adjusted p-values. Controls the family-wise error rate over the tests that can
 * each block a release.
 */
export function holm(pValues) {
    if (pValues.some((p) => !(p >= 0 && p <= 1)))
        throw new RangeError("Holm needs p-values in [0, 1]");
    const m = pValues.length;
    const order = pValues.map((p, i) => [p, i]).toSorted((a, b) => a[0] - b[0]);
    const adjusted = Array.from({ length: m }, () => 1);
    let running = 0;
    order.forEach(([p, index], rank) => {
        running = Math.max(running, Math.min(1, (m - rank) * p));
        adjusted[index] = running;
    });
    return adjusted;
}
/**
 * Benjamini–Yekutieli adjusted q-values: false discovery rate control under any dependence.
 * Used for explored slices, which never get a verdict.
 */
export function benjaminiYekutieli(pValues) {
    if (pValues.some((p) => !(p >= 0 && p <= 1)))
        throw new RangeError("Benjamini–Yekutieli needs p-values in [0, 1]");
    const m = pValues.length;
    if (m === 0)
        return [];
    let harmonic = 0;
    for (let i = 1; i <= m; i++)
        harmonic += 1 / i;
    const order = pValues.map((p, i) => [p, i]).toSorted((a, b) => a[0] - b[0]);
    const adjusted = Array.from({ length: m }, () => 1);
    let running = 1;
    for (let rank = m - 1; rank >= 0; rank--) {
        const [p, index] = order[rank];
        running = Math.min(running, Math.min(1, (p * m * harmonic) / (rank + 1)));
        adjusted[index] = running;
    }
    return adjusted;
}
//# sourceMappingURL=multiplicity.js.map