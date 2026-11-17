// The gamma and beta functions behind Student's t, Clopper–Pearson and the χ² quantile.
/** log Γ(x) for x > 0, Lanczos (g = 7, 9 terms). */
export function logGamma(x) {
    const c = [
        0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
        -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
        1.5056327351493116e-7,
    ];
    if (x < 0.5)
        return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
    const z = x - 1;
    let a = c[0];
    const t = z + 7.5;
    for (let i = 1; i < 9; i++)
        a += c[i] / (z + i);
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}
/** The regularized incomplete beta I_x(a, b), by Lentz's continued fraction. */
export function incompleteBeta(x, a, b) {
    if (x <= 0)
        return 0;
    if (x >= 1)
        return 1;
    if (x > (a + 1) / (a + b + 2))
        return 1 - incompleteBeta(1 - x, b, a);
    const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    const tiny = 1e-300;
    let f = 1;
    let c = 1;
    let d = 1 - ((a + b) * x) / (a + 1);
    if (Math.abs(d) < tiny)
        d = tiny;
    d = 1 / d;
    f = d;
    for (let m = 1; m <= 500; m++) {
        const m2 = 2 * m;
        let num = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
        d = 1 + num * d;
        if (Math.abs(d) < tiny)
            d = tiny;
        c = 1 + num / c;
        if (Math.abs(c) < tiny)
            c = tiny;
        d = 1 / d;
        f *= d * c;
        num = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
        d = 1 + num * d;
        if (Math.abs(d) < tiny)
            d = tiny;
        c = 1 + num / c;
        if (Math.abs(c) < tiny)
            c = tiny;
        d = 1 / d;
        const step = d * c;
        f *= step;
        if (Math.abs(step - 1) < 1e-16)
            break;
    }
    return (front * f) / a;
}
/** The series of P(a, x) times its front factor: accurate below a + 1. */
function lowerSeries(a, x, front) {
    let term = 1 / a;
    let sum = term;
    for (let n = 1; n < 10000; n++) {
        term *= x / (a + n);
        sum += term;
        if (Math.abs(term) < Math.abs(sum) * 1e-17)
            break;
    }
    return Math.min(1, front * sum);
}
/** The continued fraction of Q(a, x) times its front factor: accurate from a + 1 on. */
function upperFraction(a, x, front) {
    const tiny = 1e-300;
    let b = x + 1 - a;
    let c = 1 / tiny;
    let d = 1 / b;
    let h = d;
    for (let i = 1; i < 10000; i++) {
        const an = -i * (i - a);
        b += 2;
        d = an * d + b;
        if (Math.abs(d) < tiny)
            d = tiny;
        c = b + an / c;
        if (Math.abs(c) < tiny)
            c = tiny;
        d = 1 / d;
        const step = d * c;
        h *= step;
        if (Math.abs(step - 1) < 1e-16)
            break;
    }
    return front * h;
}
const gammaFront = (a, x) => Math.exp(-x + a * Math.log(x) - logGamma(a));
/** The regularized lower incomplete gamma P(a, x): by its series below a + 1, else its continued fraction. */
export function regularizedGammaP(a, x) {
    if (x <= 0)
        return 0;
    const front = gammaFront(a, x);
    return x < a + 1 ? lowerSeries(a, x, front) : Math.max(0, 1 - upperFraction(a, x, front));
}
/**
 * The regularized upper incomplete gamma Q(a, x) = 1 − P(a, x), computed directly from its continued
 * fraction from a + 1 on, so that a tail far below 1 keeps its relative precision.
 */
export function regularizedGammaQ(a, x) {
    if (x <= 0)
        return 1;
    const front = gammaFront(a, x);
    return x < a + 1
        ? Math.max(0, 1 - lowerSeries(a, x, front))
        : Math.min(1, upperFraction(a, x, front));
}
//# sourceMappingURL=beta.js.map