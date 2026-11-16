/**
 * Finds where a score function crosses a target, for inverting a test into an interval.
 *
 * `f` is a score that is large for parameter values below the data and small above them. The
 * lower bound is the smallest parameter where `f` falls below `target`. A grid scan finds the
 * first crossing, so a score that is not monotone everywhere (skewness-corrected scores near the
 * boundary, and score functions whose variance vanishes at one parameter value) still gives the
 * outermost valid root. Bisection then refines it to machine precision.
 */
export declare function lowerRoot(f: (x: number) => number, target: number, lo: number, hi: number): number;
/**
 * Whether `lowerRoot(f, target, lo, hi)` is at most `theta`, decided on lowerRoot's own path: the
 * same scan and the same bisection, stopped as soon as the answer is certain. The scan stops once
 * its last point lies above `theta` without a crossing (the root lies at or above that point);
 * the bisection stops once `theta` leaves the bracket (the root stays inside it). Otherwise the
 * root is computed exactly as lowerRoot computes it. Equal to `lowerRoot(...) <= theta` for every
 * function, monotone or not.
 */
export declare function lowerRootAtMost(f: (x: number) => number, target: number, lo: number, hi: number, theta: number): boolean;
/** The largest parameter where `f` is still above `target`, scanning from the top. */
export declare function upperRoot(f: (x: number) => number, target: number, lo: number, hi: number): number;
//# sourceMappingURL=solve.d.ts.map