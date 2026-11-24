import { expect, it } from "vitest";

import { holm } from "../../src/stats/multiplicity.ts";
import { sharpNullBlockP } from "../../src/stats/randomized-blocks.ts";
import { judge, type Point, TYPE_I } from "../stats/support/simulate.ts";

it("the locked Holm family controls false block regressions with shared assignments", () => {
  const points: Point[] = [];
  const alpha = 0.05;
  for (const measures of [1, 2, 3, 4]) {
    const minimum = Math.ceil(Math.log2(measures / alpha));
    for (let blocks = minimum; blocks <= minimum + 3; blocks++) {
      points.push({
        label: `m=${measures}, R=${blocks}`,
        seed: 2700 + 10 * measures + blocks,
        run: (rng) => {
          // All measures share each block's arm assignment. Outcomes may correlate or disagree.
          const assignments = Array.from({ length: blocks }, () => (rng.uniform() < 0.5 ? -1 : 1));
          const raw = Array.from({ length: measures }, (_, m) =>
            sharpNullBlockP(
              assignments.map((sign, b) => ({
                pairs: 20,
                numerator: sign * ((b + m) % 2 ? 1 : -1) * (1 + ((b + 2 * m) % 5)),
              })),
            ),
          );
          return holm(raw).some((p) => p <= alpha);
        },
      });
    }
  }
  expect(judge(points, TYPE_I, "locked Holm family of randomized block tests").failures).toEqual(
    [],
  );
});
