/** A seeded pseudo-random number generator. Its algorithm and seed are recorded in decisions. */
export interface Rng {
    readonly algorithm: "mt19937";
    readonly seed: number;
    /** A uniform number in [0, 1). */
    uniform(): number;
}
/** Creates the one seeded generator that every resampling method uses (32-bit Mersenne Twister). */
export declare function createRng(seed: number): Rng;
//# sourceMappingURL=rng.d.ts.map