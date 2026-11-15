// Cody's rational Chebyshev approximations for the standard normal distribution function and
// Wichura's algorithm AS 241 (PPND16) for its quantile, as R 4.5.2 implements them (nmath pnorm.c
// and qnorm.c), with the coefficients in normal-coefficients.ts. The value tests pin the functions
// against R and against mpmath at 60 digits.

import { PNORM_COEFFICIENTS, QNORM_COEFFICIENTS, type Rational } from "./normal-coefficients.ts";

const { a: A, b: B, c: C, d: D, p: P, q: Q } = PNORM_COEFFICIENTS;
const ONE_OVER_SQRT_2PI = 0.3989422804014327;
const SQRT_32 = 5.656854249492381;
const TWO_PI = 6.283185307179586;
const HALF_EPSILON = Number.EPSILON / 2;

/** exp(-x^2 / 2), split so that the square loses no precision (Cody's `do_del`). */
function gaussianFactor(x: number): number {
  const xsq = Math.trunc(x * 16) / 16;
  const del = (x - xsq) * (x + xsq);
  return Math.exp(-xsq * xsq * 0.5) * Math.exp(-del * 0.5);
}

/** Standard normal distribution function. */
export function pnorm(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  const y = Math.abs(x);
  if (y <= 0.67448975) {
    let xnum = 0;
    let xden = 0;
    if (y > HALF_EPSILON) {
      const xsq = x * x;
      xnum = A[4]! * xsq;
      xden = xsq;
      for (let i = 0; i < 3; i++) {
        xnum = (xnum + A[i]!) * xsq;
        xden = (xden + B[i]!) * xsq;
      }
    }
    return 0.5 + (x * (xnum + A[3]!)) / (xden + B[3]!);
  }
  let tail: number;
  if (y <= SQRT_32) {
    let xnum = C[8]! * y;
    let xden = y;
    for (let i = 0; i < 7; i++) {
      xnum = (xnum + C[i]!) * y;
      xden = (xden + D[i]!) * y;
    }
    tail = (gaussianFactor(y) * (xnum + C[7]!)) / (xden + D[7]!);
  } else if (x > -38.4674 && x < 8.2924) {
    const xsq = 1 / (x * x);
    let xnum = P[5]! * xsq;
    let xden = xsq;
    for (let i = 0; i < 4; i++) {
      xnum = (xnum + P[i]!) * xsq;
      xden = (xden + Q[i]!) * xsq;
    }
    const ratio = (xsq * (xnum + P[4]!)) / (xden + Q[4]!);
    tail = (gaussianFactor(y) * (ONE_OVER_SQRT_2PI - ratio)) / y;
  } else {
    // R's bounds: below -38.4674 the lower tail is under the smallest subnormal double, and above
    // 8.2924 the distribution function rounds to 1.
    return x > 0 ? 1 : 0;
  }
  return x > 0 ? 1 - tail : tail;
}

/** Horner's rule, highest power first: the same operations as R's nested expressions. */
function horner(coefficients: readonly number[], r: number): number {
  let value = coefficients[0]!;
  for (let i = 1; i < coefficients.length; i++) value = value * r + coefficients[i]!;
  return value;
}

function rational({ numerator, denominator }: Rational, r: number): number {
  return horner(numerator, r) / (horner(denominator, r) * r + 1);
}

/** Standard normal quantile function. */
export function qnorm(p: number): number {
  if (Number.isNaN(p) || p < 0 || p > 1) return Number.NaN;
  if (p === 0) return Number.NEGATIVE_INFINITY;
  if (p === 1) return Number.POSITIVE_INFINITY;
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    const { numerator, denominator } = QNORM_COEFFICIENTS.central;
    return (q * horner(numerator, r)) / (horner(denominator, r) * r + 1);
  }
  const lp = Math.log(q < 0 ? p : 1 - p);
  const r = Math.sqrt(-lp);
  let value: number;
  if (r <= 5) {
    value = rational(QNORM_COEFFICIENTS.low, r - 1.6);
  } else if (r <= 27) {
    value = rational(QNORM_COEFFICIENTS.far, r - 5);
  } else {
    // Only a subnormal p (below about 2.5e-317) gets here, and there r < 28. R's asymptotic
    // expansion for 27 < r < 55, to the fifth order.
    const s2 = -2 * lp;
    let x2 = s2 - Math.log(TWO_PI * s2);
    x2 = s2 - Math.log(TWO_PI * x2) - 2 / (2 + x2);
    x2 = s2 - Math.log(TWO_PI * x2) + 2 * Math.log1p(-(1 - 1 / (4 + x2)) / (2 + x2));
    x2 =
      s2 - Math.log(TWO_PI * x2) + 2 * Math.log1p(-(1 - (1 - 5 / (6 + x2)) / (4 + x2)) / (2 + x2));
    x2 =
      s2 -
      Math.log(TWO_PI * x2) +
      2 * Math.log1p(-(1 - (1 - (5 - 9 / (8 + x2)) / (6 + x2)) / (4 + x2)) / (2 + x2));
    value = Math.sqrt(x2);
  }
  return q < 0 ? -value : value;
}

/** The critical value of a one- or two-sided interval at a confidence level. */
export function critical(level: number, sided: "two" | "lower" | "upper"): number {
  return qnorm(sided === "two" ? 1 - (1 - level) / 2 : level);
}
