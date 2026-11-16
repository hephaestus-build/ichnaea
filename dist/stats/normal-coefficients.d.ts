/** Cody's coefficients, in R's array order. */
export declare const PNORM_COEFFICIENTS: {
    readonly a: readonly number[];
    readonly b: readonly number[];
    readonly c: readonly number[];
    readonly d: readonly number[];
    readonly p: readonly number[];
    readonly q: readonly number[];
};
export interface Rational {
    /** Highest power first. */
    readonly numerator: readonly number[];
    /** Highest power first; the constant term is 1. */
    readonly denominator: readonly number[];
}
/** AS 241's three rational functions: |p - 0.5| <= 0.425, r <= 5 and 5 < r <= 27. */
export declare const QNORM_COEFFICIENTS: {
    readonly central: Rational;
    readonly low: Rational;
    readonly far: Rational;
};
/** pnorm's branch bounds and the exponent of its exact split of x (`ldexp(trunc(ldexp(x, 4)), -4)`). */
export declare const PNORM_BOUNDS: {
    readonly central: number;
    readonly lowerTail: number;
    readonly upperTail: number;
    readonly splitExponent: number;
};
/** qnorm's branch bounds, and the shifts of r in its two tail branches. */
export declare const QNORM_BOUNDS: {
    readonly central: number;
    readonly centralSquare: number;
    readonly low: number;
    readonly lowShift: number;
    readonly far: number;
    readonly farShift: number;
};
//# sourceMappingURL=normal-coefficients.d.ts.map