const N = 624;
const M = 397;
const MATRIX_A = 0x9908b0df;
const UPPER_MASK = 0x80000000;
const LOWER_MASK = 0x7fffffff;

/**
 * The 32-bit Mersenne Twister of Matsumoto and Nishimura (1998), seeded with `init_genrand`.
 * Returns a function that yields the next 32-bit output as an unsigned integer. The sequence
 * equals numpy's `MT19937` with legacy integer seeding (test/stats/reference-numpy-mt19937.json).
 */
export function mt19937(seed: number): () => number {
  const mt = new Uint32Array(N);
  mt[0] = seed;
  for (let i = 1; i < N; i++) {
    const previous = mt[i - 1]!;
    mt[i] = Math.imul(1812433253, previous ^ (previous >>> 30)) + i;
  }
  let index = N;

  const twist = (): void => {
    for (let k = 0; k < N; k++) {
      const y = (mt[k]! & UPPER_MASK) | (mt[(k + 1) % N]! & LOWER_MASK);
      mt[k] = mt[(k + M) % N]! ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
    }
    index = 0;
  };

  return (): number => {
    if (index >= N) twist();
    let y = mt[index++]!;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  };
}
