/** log Γ(x) for x > 0, Lanczos (g = 7, 9 terms). */
export declare function logGamma(x: number): number;
/** The regularized incomplete beta I_x(a, b), by Lentz's continued fraction. */
export declare function incompleteBeta(x: number, a: number, b: number): number;
/** The regularized lower incomplete gamma P(a, x): by its series below a + 1, else its continued fraction. */
export declare function regularizedGammaP(a: number, x: number): number;
/**
 * The regularized upper incomplete gamma Q(a, x) = 1 − P(a, x), computed directly from its continued
 * fraction from a + 1 on, so that a tail far below 1 keeps its relative precision.
 */
export declare function regularizedGammaQ(a: number, x: number): number;
//# sourceMappingURL=beta.d.ts.map