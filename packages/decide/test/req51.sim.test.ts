// REQ-51's acceptance: with four correlated primary measures and no change, the rate of REGRESSION
// verdicts stays at or below α. The simulation runs the decision rule itself (decidePrimaries) on
// a layout with measures that apply to different numbers of cases.
import {
  type CaseCounts,
  createRng,
  VALIDATED_MARGIN_FLOOR,
} from "@hephaestus-build/ichnaea-stats";
import { describe, expect, it } from "vitest";

import { decidePrimaries } from "../src/index.ts";

const ALPHA = 0.05;
const REPETITIONS = 2000;
/** Cases each measure applies to, of 60. */
const APPLICABLE = [60, 52, 17, 60];
const MARGIN = Math.max(0.05, VALIDATED_MARGIN_FLOOR);

describe("REQ-51: false REGRESSION verdicts under no change", () => {
  for (const replicates of [2, 3]) {
    it(`stay at or below α with four correlated primaries, ${replicates} trials per case and arm`, () => {
      const rng = createRng(20261115 + replicates);
      let regression = 0;
      let unadjusted = 0;
      for (let rep = 0; rep < REPETITIONS; rep++) {
        // Each case has a latent quality; each trial draws one "good run" that every measure shares,
        // so the measures are correlated. Both arms draw from the same rates: there is no change.
        const quality = Array.from({ length: 60 }, () => 0.75 + 0.25 * rng.uniform());
        const cases: CaseCounts[][] = APPLICABLE.map(() => []);
        for (let c = 0; c < 60; c++) {
          const cells = APPLICABLE.map(() => ({
            base: { successes: 0, trials: 0 },
            candidate: { successes: 0, trials: 0 },
          }));
          for (const arm of ["base", "candidate"] as const)
            for (let t = 0; t < replicates; t++) {
              const good = rng.uniform() < (quality[c] as number);
              APPLICABLE.forEach((n, k) => {
                if (c >= n) return;
                const cell = (cells[k] as (typeof cells)[number])[arm];
                cell.trials++;
                if (rng.uniform() < (good ? 0.97 : 0.4)) cell.successes++;
              });
            }
          APPLICABLE.forEach((n, k) => {
            if (c < n)
              (cases[k] as CaseCounts[]).push({
                id: `c${c}`,
                ...(cells[k] as (typeof cells)[number]),
              });
          });
        }
        const verdicts = decidePrimaries({
          estimand: "fixed-cases",
          alpha: ALPHA,
          seed: rep + 1,
          measures: cases.map((cs, k) => ({
            measure: `app/m${k}`,
            margin: MARGIN,
            valueType: "binary",
            cases: cs,
          })),
        });
        const all = [...verdicts.values()];
        if (all.some((v) => v.verdict === "REGRESSION")) regression++;
        // The same rule without Holm, to show that the simulation can see a missing adjustment.
        if (
          all.some(
            (v) =>
              v.comparison?.validated === true &&
              v.verdict !== "NON-INFERIOR" &&
              v.comparison.regressionP <= ALPHA,
          )
        )
          unadjusted++;
      }
      const rate = regression / REPETITIONS;
      const se = Math.sqrt((rate * (1 - rate)) / REPETITIONS);
      console.log(
        `r = ${replicates}, ${REPETITIONS} repetitions: REGRESSION ${rate.toFixed(4)} (SE ${se.toFixed(4)}), without Holm ${(unadjusted / REPETITIONS).toFixed(4)}`,
      );
      expect(rate).toBeLessThanOrEqual(ALPHA);
      expect(unadjusted / REPETITIONS).toBeGreaterThan(ALPHA);
    });
  }
});
