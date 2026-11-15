// Cody's rational Chebyshev approximations for the standard normal distribution function and
// Wichura's algorithm AS 241 (PPND16) for its quantile, with the coefficients R uses (nmath
// pnorm.c and qnorm.c), each written as the shortest literal of the same double.
// test/reference-r-normal.json pins both against R.

const A = [
  2.2352520354606837, 161.02823106855587, 1067.6894854603709, 18154.98125334356,
  0.06568233791820745,
] as const;
const B = [47.202581904688245, 976.0985517377767, 10260.932208618979, 45507.78933502673] as const;
const C = [
  0.39894151208813466, 8.883149794388377, 93.50665613217785, 597.2702763948002, 2494.5375852903726,
  6848.190450536283, 11602.65143764735, 9842.714838383978, 1.0765576773720192e-8,
] as const;
const D = [
  22.266688044328117, 235.387901782625, 1519.3775994075547, 6485.558298266761, 18615.571640885097,
  34900.95272114598, 38912.00328609327, 19685.429676859992,
] as const;
const P = [
  0.215898534057957, 0.12740116116024736, 0.022235277870649807, 0.0014216191932278934,
  0.000029112874951168793, 0.023073441764940174,
] as const;
const Q = [
  1.284260096144911, 0.4682382124808651, 0.06598813786892856, 0.0037823963320275824,
  0.00007297515550839662,
] as const;

const ONE_OVER_SQRT_2PI = 0.3989422804014327;
const SQRT_32 = 5.656854249492381;
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
      xnum = A[4] * xsq;
      xden = xsq;
      for (let i = 0; i < 3; i++) {
        xnum = (xnum + A[i]!) * xsq;
        xden = (xden + B[i]!) * xsq;
      }
    }
    return 0.5 + (x * (xnum + A[3])) / (xden + B[3]);
  }
  let tail: number;
  if (y <= SQRT_32) {
    let xnum = C[8] * y;
    let xden = y;
    for (let i = 0; i < 7; i++) {
      xnum = (xnum + C[i]!) * y;
      xden = (xden + D[i]!) * y;
    }
    tail = (gaussianFactor(y) * (xnum + C[7])) / (xden + D[7]);
  } else if (y < 40) {
    const xsq = 1 / (x * x);
    let xnum = P[5] * xsq;
    let xden = xsq;
    for (let i = 0; i < 4; i++) {
      xnum = (xnum + P[i]!) * xsq;
      xden = (xden + Q[i]!) * xsq;
    }
    const ratio = (xsq * (xnum + P[4])) / (xden + Q[4]);
    tail = (gaussianFactor(y) * (ONE_OVER_SQRT_2PI - ratio)) / y;
  } else {
    // Below -40 the lower tail is under the smallest subnormal double.
    tail = 0;
  }
  return x > 0 ? 1 - tail : tail;
}

/** Standard normal quantile function. */
export function qnorm(p: number): number {
  if (Number.isNaN(p) || p < 0 || p > 1) return Number.NaN;
  if (p === 0) return Number.NEGATIVE_INFINITY;
  if (p === 1) return Number.POSITIVE_INFINITY;
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return (
      (q *
        (((((((r * 2509.0809287301227 + 33430.57558358813) * r + 67265.7709270087) * r +
          45921.95393154987) *
          r +
          13731.69376550946) *
          r +
          1971.5909503065513) *
          r +
          133.14166789178438) *
          r +
          3.3871328727963665)) /
      (((((((r * 5226.495278852546 + 28729.085735721943) * r + 39307.89580009271) * r +
        21213.794301586597) *
        r +
        5394.196021424751) *
        r +
        687.1870074920579) *
        r +
        42.31333070160091) *
        r +
        1)
    );
  }
  let r = Math.sqrt(-Math.log(q < 0 ? p : 1 - p));
  let value: number;
  if (r <= 5) {
    r -= 1.6;
    value =
      (((((((r * 0.0007745450142783414 + 0.022723844989269184) * r + 0.2417807251774506) * r +
        1.2704582524523684) *
        r +
        3.6478483247632045) *
        r +
        5.769497221460691) *
        r +
        4.630337846156546) *
        r +
        1.4234371107496835) /
      (((((((r * 1.0507500716444169e-9 + 0.0005475938084995345) * r + 0.015198666563616457) * r +
        0.14810397642748008) *
        r +
        0.6897673349851) *
        r +
        1.6763848301838038) *
        r +
        2.053191626637759) *
        r +
        1);
  } else {
    r -= 5;
    value =
      (((((((r * 2.0103343992922881e-7 + 0.000027115555687434876) * r + 0.0012426609473880784) * r +
        0.026532189526576124) *
        r +
        0.29656057182850487) *
        r +
        1.7848265399172913) *
        r +
        5.463784911164114) *
        r +
        6.657904643501103) /
      (((((((r * 2.0442631033899397e-15 + 1.421511758316446e-7) * r + 0.000018463183175100548) * r +
        0.0007868691311456133) *
        r +
        0.014875361290850615) *
        r +
        0.1369298809227358) *
        r +
        0.599832206555888) *
        r +
        1);
  }
  return q < 0 ? -value : value;
}

/** The critical value of a one- or two-sided interval at a confidence level. */
export function critical(level: number, sided: "two" | "lower" | "upper"): number {
  return qnorm(sided === "two" ? 1 - (1 - level) / 2 : level);
}
