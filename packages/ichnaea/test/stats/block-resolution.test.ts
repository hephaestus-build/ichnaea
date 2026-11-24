import fc from "fast-check";
import { expect, it } from "vitest";

import { blockSignP } from "../../src/stats/block-sign.ts";
import { blockResolution, defaultBaseRates } from "../../src/stats/block-resolution.ts";
import { DEFAULT_BLOCK_DROPS } from "../../src/stats/block-resolution-table.ts";

it("matches an independent enumeration of the assigned signs and includes ties", () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: -10, max: 10 }), { minLength: 1, maxLength: 8 }),
      (contrasts) => {
        const observed = contrasts.reduce((sum, difference) => sum + difference, 0);
        const assignments = 2 ** contrasts.length;
        let lower = 0;
        for (let mask = 0; mask < assignments; mask++) {
          const changed = contrasts.reduce(
            (sum, difference, index) => sum + (mask & (1 << index) ? -difference : difference),
            0,
          );
          if (changed <= observed) lower++;
        }
        expect(blockSignP(contrasts)).toBe(lower / assignments);
      },
    ),
  );
});

it("reports power at the extreme when a four-block test cannot reject at 5%", () => {
  expect(blockResolution({ baseRates: [1, 1, 1], blocks: 4, replicates: 1, level: 0.05 })).toEqual({
    kind: "extreme",
    power: 0,
  });
});

it("reproduces the default table using the recorded simulation model", () => {
  for (const [cases, drops] of Object.entries(DEFAULT_BLOCK_DROPS))
    for (const [index, drop] of drops.entries()) {
      const level = 0.05 / (index + 1);
      const blocks = Math.ceil(Math.log2(1 / level)) + 1;
      expect(
        blockResolution({
          baseRates: defaultBaseRates(Number(cases)),
          blocks,
          replicates: 1,
          level,
        }),
      ).toEqual({ kind: "detectable-drop", drop });
    }
}, 12_000);
