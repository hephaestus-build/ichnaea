import { incompleteBeta } from "./beta.js";
import { assertCount, assertLevel } from "./types.js";
/** The p in (0, 1) where the increasing function f(p) reaches the target, by bisection. */
function invert(f, target) {
    let low = 0;
    let high = 1;
    for (let i = 0; i < 1100; i++) {
        const mid = (low + high) / 2;
        if (mid === low || mid === high)
            break;
        if (f(mid) < target)
            low = mid;
        else
            high = mid;
    }
    return (low + high) / 2;
}
/**
 * The exact Clopper–Pearson interval for one binomial proportion. Each bounded side holds its
 * share of 1 − level: (1 − level)/2 on two sides, 1 − level on one. Its coverage is at least the
 * level at every true rate of one binomial. For the pooled count of independent trials at unequal
 * rates, use `pooledClopperPearson`. Zero trials give [0, 1] with an undefined (NaN) estimate.
 */
export function clopperPearson(count, level = 0.95, sided = "two") {
    assertCount(count, "clopperPearson");
    assertLevel(level);
    const { successes: x, trials: n } = count;
    const method = "clopper-pearson";
    if (n === 0)
        return { estimate: Number.NaN, lower: 0, upper: 1, level, sided, method };
    const tail = sided === "two" ? (1 - level) / 2 : 1 - level;
    // P(X ≥ x | p) = I_p(x, n − x + 1) and P(X ≤ x | p) = 1 − I_p(x + 1, n − x). The boundary counts
    // have closed forms, which keep full precision at large n.
    let lower = 0;
    if (sided !== "upper" && x > 0)
        lower = x === n ? tail ** (1 / n) : invert((p) => incompleteBeta(p, x, n - x + 1), tail);
    let upper = 1;
    if (sided !== "lower" && x < n)
        upper =
            x === 0 ? 1 - tail ** (1 / n) : invert((p) => incompleteBeta(p, x + 1, n - x), 1 - tail);
    return { estimate: x / n, lower, upper, level, sided, method };
}
/** The largest adjusted level per bound for which the adjustment holds. */
const MAX_ADJUSTED_TAIL = 0.25;
/**
 * Clopper–Pearson on the pooled count at the adjusted level α′ = 1 − e^{−α} per bound
 * (1 − e^{−α/2} per tail for a two-sided interval). With independent trials at unequal rates, the
 * count is Poisson-binomial. The bound then misses the mean rate with probability below α, for every
 * set of rates (Hoeffding 1956, Theorem 4, as restated in Bancal and Sekatski 2022, § II; Greenberg
 * and Mohri 2014; and Weierstrass's product inequality). Unadjusted CP can miss at a rate up to
 * −ln(1 − α), at extreme means.
 *
 * The proof needs α′ ≤ 1/4 per bound, so a larger one is refused. The result carries the level
 * asked for, and the method "clopper-pearson-adjusted".
 */
export function pooledClopperPearson(count, level = 0.95, sided = "two") {
    assertLevel(level);
    const alpha = 1 - level;
    const tail = sided === "two" ? 1 - Math.exp(-alpha / 2) : 1 - Math.exp(-alpha);
    if (tail > MAX_ADJUSTED_TAIL)
        throw new RangeError(`pooledClopperPearson: the adjusted level ${tail} per bound is above 1/4, where the bound is not proven`);
    const adjusted = clopperPearson(count, sided === "two" ? 1 - 2 * tail : 1 - tail, sided);
    return { ...adjusted, level, method: "clopper-pearson-adjusted" };
}
//# sourceMappingURL=clopper-pearson.js.map