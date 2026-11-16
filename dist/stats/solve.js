/**
 * Finds where a score function crosses a target, for inverting a test into an interval.
 *
 * `f` is a score that is large for parameter values below the data and small above them. The
 * lower bound is the smallest parameter where `f` falls below `target`. A grid scan finds the
 * first crossing, so a score that is not monotone everywhere (skewness-corrected scores near the
 * boundary) still gives the outermost valid root. Bisection then refines it to machine precision.
 */
export function lowerRoot(f, target, lo, hi) {
    const steps = 50;
    if (f(lo) < target)
        return lo;
    let prev = lo;
    for (let i = 1; i <= steps; i++) {
        const x = lo + ((hi - lo) * i) / steps;
        if (f(x) < target)
            return bisect(f, target, prev, x);
        prev = x;
    }
    return hi;
}
/** The largest parameter where `f` is still above `target`, scanning from the top. */
export function upperRoot(f, target, lo, hi) {
    const steps = 50;
    if (f(hi) > target)
        return hi;
    let prev = hi;
    for (let i = 1; i <= steps; i++) {
        const x = hi - ((hi - lo) * i) / steps;
        if (f(x) > target)
            return bisect(f, target, x, prev);
        prev = x;
    }
    return lo;
}
/** Bisection for f(a) >= target > f(b) on [a, b]. */
function bisect(f, target, a, b) {
    let low = a;
    let high = b;
    for (let i = 0; i < 200 && high - low > 1e-13; i++) {
        const mid = (low + high) / 2;
        if (f(mid) >= target)
            low = mid;
        else
            high = mid;
    }
    return (low + high) / 2;
}
//# sourceMappingURL=solve.js.map