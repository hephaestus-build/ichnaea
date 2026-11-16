/**
 * The 32-bit Mersenne Twister of Matsumoto and Nishimura (1998), seeded with `init_genrand`.
 * Returns a function that yields the next 32-bit output as an unsigned integer. The sequence
 * equals numpy's `MT19937` with legacy integer seeding (test/stats/reference-numpy-mt19937.json).
 */
export declare function mt19937(seed: number): () => number;
//# sourceMappingURL=mt19937.d.ts.map