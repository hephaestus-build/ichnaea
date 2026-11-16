// The grid of the simulation studies: per-case rates for each scenario and the draw of per-case
// counts, shared by every study file.
import type { CaseCounts, Rng } from "../../src/index.ts";
import { binomial } from "./simulate.ts";

export const LEVEL = 0.95;

export function rates(k: number, scenario: string): number[] {
  if (scenario === "mixture")
    return Array.from({ length: k }, (_, i) =>
      i < Math.round(0.7 * k) ? 1 : i < Math.round(0.9 * k) ? 0.8 : 0.3,
    );
  if (scenario === "low")
    return Array.from({ length: k }, (_, i) => 0.03 + (0.27 * i) / Math.max(1, k - 1));
  return Array.from({ length: k }, () => Number(scenario));
}

export const clamp = (p: number): number => Math.min(1, Math.max(0, p));

/**
 * Draws per-case counts. `r` gives a case's planned trials per arm; `lose` drops that many of its
 * candidate trials, as missing (informative when it is tied to the drop).
 */
export function draw(
  rng: Rng,
  base: readonly number[],
  cand: readonly number[],
  r: (j: number) => number,
  lose: (j: number) => number = () => 0,
): CaseCounts[] {
  return base.map((p, j) => {
    const nb = r(j);
    const nc = r(j) - lose(j);
    return {
      id: `c${j}`,
      candidate: { successes: binomial(rng, nc, cand[j] as number), trials: nc },
      base: { successes: binomial(rng, nb, p), trials: nb },
    };
  });
}

export const truthOf = (base: readonly number[], cand: readonly number[]): number =>
  cand.reduce((a, q, i) => a + q - (base[i] as number), 0) / base.length;
