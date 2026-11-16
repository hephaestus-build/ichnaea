// The coefficients and branch bounds of R 4.5.2's pnorm (Cody) and qnorm (AS 241), each written
// as the shortest literal of the same double. Internal: test/stats/reference-normal-coefficients.json
// pins every value against R's source.

/** Cody's coefficients, in R's array order. */
export const PNORM_COEFFICIENTS: {
  readonly a: readonly number[];
  readonly b: readonly number[];
  readonly c: readonly number[];
  readonly d: readonly number[];
  readonly p: readonly number[];
  readonly q: readonly number[];
} = {
  a: [
    2.2352520354606837, 161.02823106855587, 1067.6894854603709, 18154.98125334356,
    0.06568233791820745,
  ],
  b: [47.202581904688245, 976.0985517377767, 10260.932208618979, 45507.78933502673],
  c: [
    0.39894151208813466, 8.883149794388377, 93.50665613217785, 597.2702763948002,
    2494.5375852903726, 6848.190450536283, 11602.65143764735, 9842.714838383978,
    1.0765576773720192e-8,
  ],
  d: [
    22.266688044328117, 235.387901782625, 1519.3775994075547, 6485.558298266761, 18615.571640885097,
    34900.95272114598, 38912.00328609327, 19685.429676859992,
  ],
  p: [
    0.215898534057957, 0.12740116116024736, 0.022235277870649807, 0.0014216191932278934,
    2.9112874951168793e-5, 0.023073441764940174,
  ],
  q: [
    1.284260096144911, 0.4682382124808651, 0.06598813786892856, 0.0037823963320275824,
    7.297515550839662e-5,
  ],
};

export interface Rational {
  /** Highest power first. */
  readonly numerator: readonly number[];
  /** Highest power first; the constant term is 1. */
  readonly denominator: readonly number[];
}

/** AS 241's three rational functions: |p - 0.5| <= 0.425, r <= 5 and 5 < r <= 27. */
export const QNORM_COEFFICIENTS: {
  readonly central: Rational;
  readonly low: Rational;
  readonly far: Rational;
} = {
  central: {
    numerator: [
      2509.0809287301227, 33430.57558358813, 67265.7709270087, 45921.95393154987, 13731.69376550946,
      1971.5909503065513, 133.14166789178438, 3.3871328727963665,
    ],
    denominator: [
      5226.495278852854, 28729.085735721943, 39307.89580009271, 21213.794301586597,
      5394.196021424751, 687.1870074920579, 42.31333070160091,
    ],
  },
  low: {
    numerator: [
      0.0007745450142783414, 0.022723844989269184, 0.2417807251774506, 1.2704582524523684,
      3.6478483247632045, 5.769497221460691, 4.630337846156546, 1.4234371107496835,
    ],
    denominator: [
      1.0507500716444169e-9, 0.0005475938084995345, 0.015198666563616457, 0.14810397642748008,
      0.6897673349851, 1.6763848301838038, 2.053191626637759,
    ],
  },
  far: {
    numerator: [
      2.0103343992922881e-7, 2.7115555687434876e-5, 0.0012426609473880784, 0.026532189526576124,
      0.29656057182850487, 1.7848265399172913, 5.463784911164114, 6.657904643501103,
    ],
    denominator: [
      2.0442631033899397e-15, 1.421511758316446e-7, 1.8463183175100548e-5, 0.0007868691311456133,
      0.014875361290850615, 0.1369298809227358, 0.599832206555888,
    ],
  },
};

/** pnorm's branch bounds and the exponent of its exact split of x (`ldexp(trunc(ldexp(x, 4)), -4)`). */
export const PNORM_BOUNDS: {
  readonly central: number;
  readonly lowerTail: number;
  readonly upperTail: number;
  readonly splitExponent: number;
} = { central: 0.67448975, lowerTail: -38.4674, upperTail: 8.2924, splitExponent: 4 };

/** qnorm's branch bounds, and the shifts of r in its two tail branches. */
export const QNORM_BOUNDS: {
  readonly central: number;
  readonly centralSquare: number;
  readonly low: number;
  readonly lowShift: number;
  readonly far: number;
  readonly farShift: number;
} = { central: 0.425, centralSquare: 0.180625, low: 5, lowShift: 1.6, far: 27, farShift: 5 };
