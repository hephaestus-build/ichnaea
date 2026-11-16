import { mt19937 } from "./mt19937.js";
/** Creates the one seeded generator that every resampling method uses (32-bit Mersenne Twister). */
export function createRng(seed) {
    if (!Number.isInteger(seed) || seed < 1 || seed > 4294967295) {
        throw new RangeError(`seed must be an integer in [1, 2^32 - 1], got ${seed}`);
    }
    const next = mt19937(seed);
    // genrand_res53 of the reference implementation: a uniform double with 53 random bits.
    const uniform = () => ((next() >>> 5) * 67108864 + (next() >>> 6)) / 9007199254740992;
    return { algorithm: "mt19937", seed, uniform };
}
//# sourceMappingURL=rng.js.map