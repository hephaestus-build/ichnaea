/** C(a, k)/C(r, k) as a product, exact for small k and stable for large r. */
function chooseRatio(a, r, k) {
    let ratio = 1;
    for (let j = 0; j < k; j++)
        ratio *= (a - j) / (r - j);
    return Math.max(0, ratio);
}
/**
 * Reduces the r trials of one case. With c passes: `all` gives C(c, k)/C(r, k), the unbiased
 * estimate of pass^k; `any` gives 1 − C(r − c, k)/C(r, k), the unbiased estimate of pass@k; and
 * `majority` gives 1 above r/2, 0 below, and the tie rule at exactly r/2. r < k is refused.
 */
export function reduceTrials(values, reduction) {
    if (values.length === 0)
        throw new RangeError("a reduction needs at least one trial");
    for (const v of values)
        if (v !== 0 && v !== 1)
            throw new RangeError(`a reduction takes 0 or 1 values, got ${v}`);
    const r = values.length;
    const c = values.reduce((a, b) => a + b, 0);
    if ("majority" in reduction) {
        if (2 * c === r)
            return reduction.majority.tie === "pass" ? 1 : 0;
        return 2 * c > r ? 1 : 0;
    }
    const k = "all" in reduction ? reduction.all.k : reduction.any.k;
    if (!(Number.isInteger(k) && k >= 1))
        throw new RangeError(`k must be a positive integer, got ${k}`);
    if (r < k)
        throw new RangeError(`${r} trials cannot estimate a reduction over k = ${k}`);
    return "all" in reduction ? chooseRatio(c, r, k) : 1 - chooseRatio(r - c, r, k);
}
//# sourceMappingURL=reduce.js.map