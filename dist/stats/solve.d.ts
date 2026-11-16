/**
 * Finds where a score function crosses a target, for inverting a test into an interval.
 *
 * `f` is a score that is large for parameter values below the data and small above them. The
 * lower bound is the smallest parameter where `f` falls below `target`. A grid scan finds the
 * first crossing, so a score that is not monotone everywhere (skewness-corrected scores near the
 * boundary) still gives the outermost valid root. Bisection then refines it to machine precision.
 */
export declare function lowerRoot(f: (x: number) => number, target: number, lo: number, hi: number): number;
/** The largest parameter where `f` is still above `target`, scanning from the top. */
export declare function upperRoot(f: (x: number) => number, target: number, lo: number, hi: number): number;
//# sourceMappingURL=solve.d.ts.map