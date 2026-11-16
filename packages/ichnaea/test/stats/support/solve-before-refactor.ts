// A verbatim copy of src/stats/solve.ts as it was before the root-finder shared its scan and
// bisection with lowerRootAtMost (main at c3e389f). test/stats/solver-snapshot.test.ts swaps it in
// for the current solver and requires every binary bound bit for bit, on the machine that runs the
// test. Do not edit the functions below: they are the reference.

/** Marks this module, so the test can check that the swap took effect. */
export const BEFORE_REFACTOR = true;

/**
 * Finds where a score function crosses a target, for inverting a test into an interval.
 *
 * `f` is a score that is large for parameter values below the data and small above them. The
 * lower bound is the smallest parameter where `f` falls below `target`. A grid scan finds the
 * first crossing, so a score that is not monotone everywhere (skewness-corrected scores near the
 * boundary) still gives the outermost valid root. Bisection then refines it to machine precision.
 */
export function lowerRoot(
  f: (x: number) => number,
  target: number,
  lo: number,
  hi: number,
): number {
  const steps = 50;
  if (f(lo) < target) return lo;
  let prev = lo;
  for (let i = 1; i <= steps; i++) {
    const x = lo + ((hi - lo) * i) / steps;
    if (f(x) < target) return bisect(f, target, prev, x);
    prev = x;
  }
  return hi;
}

/** The largest parameter where `f` is still above `target`, scanning from the top. */
export function upperRoot(
  f: (x: number) => number,
  target: number,
  lo: number,
  hi: number,
): number {
  const steps = 50;
  if (f(hi) > target) return hi;
  let prev = hi;
  for (let i = 1; i <= steps; i++) {
    const x = hi - ((hi - lo) * i) / steps;
    if (f(x) > target) return bisect(f, target, x, prev);
    prev = x;
  }
  return lo;
}

/** Bisection for f(a) >= target > f(b) on [a, b]. */
function bisect(f: (x: number) => number, target: number, a: number, b: number): number {
  let low = a;
  let high = b;
  for (let i = 0; i < 200 && high - low > 1e-13; i++) {
    const mid = (low + high) / 2;
    if (f(mid) >= target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}
