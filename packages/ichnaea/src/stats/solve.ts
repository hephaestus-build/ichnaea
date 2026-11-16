/** Grid steps of the scan for the first crossing. */
const STEPS = 50;

/**
 * The scan for the lower root: where `f` first falls below `target`, scanning [lo, hi] in STEPS
 * steps. `beyond` stops early once the last point checked lies above it without a crossing, for a
 * caller that only asks whether the root is at most `beyond`.
 */
type Scan =
  | { readonly kind: "at"; readonly x: number }
  | { readonly kind: "bracket"; readonly a: number; readonly b: number }
  | { readonly kind: "beyond" };

function scanLower(
  f: (x: number) => number,
  target: number,
  lo: number,
  hi: number,
  beyond: number,
): Scan {
  if (f(lo) < target) return { kind: "at", x: lo };
  let prev = lo;
  for (let i = 1; i <= STEPS; i++) {
    if (prev > beyond) return { kind: "beyond" };
    const x = lo + ((hi - lo) * i) / STEPS;
    if (f(x) < target) return { kind: "bracket", a: prev, b: x };
    prev = x;
  }
  return { kind: "at", x: hi };
}

/**
 * Finds where a score function crosses a target, for inverting a test into an interval.
 *
 * `f` is a score that is large for parameter values below the data and small above them. The
 * lower bound is the smallest parameter where `f` falls below `target`. A grid scan finds the
 * first crossing, so a score that is not monotone everywhere (skewness-corrected scores near the
 * boundary, and score functions whose variance vanishes at one parameter value) still gives the
 * outermost valid root. Bisection then refines it to machine precision.
 */
export function lowerRoot(
  f: (x: number) => number,
  target: number,
  lo: number,
  hi: number,
): number {
  const scan = scanLower(f, target, lo, hi, Number.POSITIVE_INFINITY);
  if (scan.kind === "at") return scan.x;
  if (scan.kind === "beyond") return hi;
  const [low, high] = bisect(f, target, scan.a, scan.b, undefined);
  return (low + high) / 2;
}

/**
 * Whether `lowerRoot(f, target, lo, hi)` is at most `theta`, decided on lowerRoot's own path: the
 * same scan and the same bisection, stopped as soon as the answer is certain. The scan stops once
 * its last point lies above `theta` without a crossing (the root lies at or above that point);
 * the bisection stops once `theta` leaves the bracket (the root stays inside it). Otherwise the
 * root is computed exactly as lowerRoot computes it. Equal to `lowerRoot(...) <= theta` for every
 * function, monotone or not.
 */
export function lowerRootAtMost(
  f: (x: number) => number,
  target: number,
  lo: number,
  hi: number,
  theta: number,
): boolean {
  const scan = scanLower(f, target, lo, hi, theta);
  if (scan.kind === "at") return scan.x <= theta;
  if (scan.kind === "beyond") return false;
  let answer: boolean | undefined;
  const [low, high] = bisect(f, target, scan.a, scan.b, (l, h) => {
    if (theta < l) answer = false;
    else if (theta >= h) answer = true;
    return answer === undefined;
  });
  return answer ?? (low + high) / 2 <= theta;
}

/** The largest parameter where `f` is still above `target`, scanning from the top. */
export function upperRoot(
  f: (x: number) => number,
  target: number,
  lo: number,
  hi: number,
): number {
  if (f(hi) > target) return hi;
  let prev = hi;
  for (let i = 1; i <= STEPS; i++) {
    const x = hi - ((hi - lo) * i) / STEPS;
    if (f(x) > target) {
      const [low, high] = bisect(f, target, x, prev, undefined);
      return (low + high) / 2;
    }
    prev = x;
  }
  return lo;
}

/**
 * Bisection for f(a) >= target > f(b) on [a, b], to a bracket of width 1e-13. `keepGoing`, when
 * given, sees the bracket before each step and may stop the bisection early.
 */
function bisect(
  f: (x: number) => number,
  target: number,
  a: number,
  b: number,
  keepGoing: ((low: number, high: number) => boolean) | undefined,
): [number, number] {
  let low = a;
  let high = b;
  for (let i = 0; i < 200 && high - low > 1e-13; i++) {
    if (keepGoing !== undefined && !keepGoing(low, high)) break;
    const mid = (low + high) / 2;
    if (f(mid) >= target) low = mid;
    else high = mid;
  }
  return [low, high];
}
