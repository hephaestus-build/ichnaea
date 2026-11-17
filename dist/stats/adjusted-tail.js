// The adjusted level of the pooled Clopper–Pearson bound. It is internal: the stats barrel does not
// re-export this module, so the level is not part of the public API.
import { assertLevel } from "./types.js";
/** The largest adjusted level per bound for which the adjustment holds. */
const MAX_ADJUSTED_TAIL = 0.25;
/**
 * The adjusted level α′ = 1 − e^{−α} per bound (1 − e^{−α/2} per tail for a two-sided interval) that
 * `pooledClopperPearson` runs at. The proof needs α′ ≤ 1/4 per bound, so a larger one is refused,
 * here, for every caller that plans or computes the pooled bound.
 */
export function adjustedTail(level, sided) {
    assertLevel(level);
    const alpha = 1 - level;
    const tail = sided === "two" ? 1 - Math.exp(-alpha / 2) : 1 - Math.exp(-alpha);
    if (tail > MAX_ADJUSTED_TAIL)
        throw new RangeError(`the adjusted level ${tail} per bound is above 1/4, where the pooled bound is not proven`);
    return tail;
}
//# sourceMappingURL=adjusted-tail.js.map