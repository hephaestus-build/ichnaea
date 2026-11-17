import { type Sided } from "./types.ts";
/**
 * The adjusted level α′ = 1 − e^{−α} per bound (1 − e^{−α/2} per tail for a two-sided interval) that
 * `pooledClopperPearson` runs at. The proof needs α′ ≤ 1/4 per bound, so a larger one is refused,
 * here, for every caller that plans or computes the pooled bound.
 */
export declare function adjustedTail(level: number, sided: Sided): number;
//# sourceMappingURL=adjusted-tail.d.ts.map