// The planner page's own helpers. This module imports nothing, so the page's script stays small:
// only the worker loads the library.

/**
 * The largest seed that the address may carry. The library's generator takes 1 to 2^32 − 1, and
 * the detection search draws with the seed plus one.
 */
export const MAX_SEED = 4294967294;

/** The seed from the address: 1 when there is none, undefined when it is not a valid seed. */
export function plannerSeed(raw: string | null): number | undefined {
  if (raw === null || raw === "") return 1;
  const seed = Number(raw);
  return Number.isInteger(seed) && seed >= 1 && seed <= MAX_SEED ? seed : undefined;
}

const points = (fraction: number): string =>
  `${(fraction * 100).toFixed(1).replace(/\.0$/, "")} points`;

/**
 * The sentence for the smallest detected decrease. The search stops within one point, but that
 * is its resolution, not the simulation's uncertainty, which the page does not estimate.
 */
export function detectableSentence(
  detectable: number | undefined,
  runs: number,
  validated: boolean,
): string {
  if (!validated) return "None: without a validated test, no decrease gives a Regression.";
  if (detectable === undefined)
    return `Not reached: even the largest decrease is detected in fewer than 80% of runs (${runs} simulated runs per step).`;
  return `About ${points(detectable)}: each case's pass rate falls by that much, or to zero if it is lower. The search stops within 1 point. Each step simulates ${runs} runs, so another seed can give a different number.`;
}
