import fc from "fast-check";
import { expect, it } from "vitest";

import { summarizeRatings } from "../../src/calibration/ratings-agreement.ts";

it("preserves ordinal agreement and its interval when raters are reordered or levels are relabelled", () => {
  const row = fc.tuple(fc.integer({ min: 1, max: 4 }), fc.option(fc.integer({ min: 1, max: 4 })));
  fc.assert(
    fc.property(fc.array(row, { minLength: 2, maxLength: 8 }), (rows) => {
      const units = rows.map((raters, index) => ({
        item: String(Math.floor(index / 2)),
        stratum: "all",
        raters,
      }));
      const relabelled = units.map((unit) => ({
        ...unit,
        raters: unit.raters.toReversed().map((value) => (value === null ? null : value ** 2)),
      }));
      expect(summarizeRatings({ metric: "ordinal", units }, 42)).toEqual(
        summarizeRatings({ metric: "ordinal", units: relabelled }, 42),
      );
    }),
    { numRuns: 25 },
  );
});

it("reports unavailable alpha when no unit has more than one observed rating", () => {
  const units = [
    { item: "item1", stratum: "all", raters: [1, null] },
    { item: "item2", stratum: "all", raters: [null, 1] },
  ];
  expect(summarizeRatings({ metric: "nominal", units }, 42)).toMatchObject({
    estimate: null,
    counts: { ratings: 2, pairedRatings: 0, pairedItems: 0 },
    interval: { lower: null, upper: null, resamples: 0 },
  });
});

it("refuses conflicting strata without quoting input identifiers", () => {
  const units = [
    { item: "item1", stratum: "a", raters: [1, 2] },
    { item: "item1", stratum: "b", raters: [1, 2] },
  ];
  expect(() => summarizeRatings({ metric: "ordinal", units }, 42)).toThrow(
    "an item cannot belong to more than one stratum",
  );
});

it("resamples each item's ratings together while keeping the other stratum fixed", () => {
  const units = [
    { item: "a", stratum: "variable", raters: [1, 1] },
    { item: "a", stratum: "variable", raters: [2, 2] },
    { item: "b", stratum: "variable", raters: [1, 2] },
    { item: "b", stratum: "variable", raters: [1, 2] },
    { item: "c", stratum: "fixed", raters: [1, 1] },
    { item: "c", stratum: "fixed", raters: [2, 2] },
  ];
  // There are three possible sets: aa+c, ab+c, and bb+c. The fixed stratum supplies c.
  // The last has 12 ratings, six of each level, and eight disagreements in the
  // coincidence matrix. Alpha is 1 - 11 * 8 / 72. Agreement is perfect in aa+c.
  expect(summarizeRatings({ metric: "nominal", units }, 42).interval).toMatchObject({
    lower: expect.closeTo(-2 / 9, 12),
    upper: 1,
    unavailableReason: null,
  });
});

it("gives no interval when the strata allow no resampling variation", () => {
  const units = [
    { item: "a", stratum: "a", raters: [1, 2] },
    { item: "b", stratum: "b", raters: [1, 1] },
  ];
  expect(summarizeRatings({ metric: "nominal", units }, 42).interval).toMatchObject({
    lower: null,
    upper: null,
    unavailableReason: "every stratum has only one item",
  });
});
