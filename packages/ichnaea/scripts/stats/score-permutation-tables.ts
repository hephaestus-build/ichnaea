// Writes test/stats/reference-score-permutation-tables.json: the tables on which the score permutation test is
// checked against its oracles (scripts/reference-score-permutation.R and .py). Every value is an
// integer number of units over the table's denominator, so each oracle reads exact rationals.
//   node scripts/score-permutation-tables.ts
import { writeFileSync } from "node:fs";

import { createRng, type Rng } from "../../src/stats/rng.ts";

interface Table {
  readonly id: string;
  readonly denominator: number;
  readonly cases: { candidate: number[]; base: number[] }[];
}

const rng: Rng = createRng(20261116);
const integer = (lo: number, hi: number): number => lo + Math.floor(rng.uniform() * (hi - lo + 1));
/** A level from 0 to `top`, near `centre` (in units), moved by `shift` units. */
const near = (centre: number, spread: number, top: number, shift = 0): number =>
  Math.min(top, Math.max(0, Math.round(centre + shift + (rng.uniform() * 2 - 1) * spread)));

const tables: Table[] = [];
const add = (id: string, denominator: number, cases: Table["cases"]): void => {
  tables.push({ id, denominator, cases });
};

/** Per-case centres, trial counts per arm and a shift of the candidate (in units). */
function draw(
  denominator: number,
  k: number,
  trials: (i: number) => readonly [candidate: number, base: number],
  spread: number,
  shift: number,
): Table["cases"] {
  return Array.from({ length: k }, (_, i) => {
    const centre = integer(0, denominator);
    const [nc, nb] = trials(i);
    return {
      candidate: Array.from({ length: nc }, () => near(centre, spread, denominator, shift)),
      base: Array.from({ length: nb }, () => near(centre, spread, denominator)),
    };
  });
}

// 1–5 ratings normalised as (s − 1) / 4: equal counts, k from 1 to 12, r from 1 to 3, with and
// without a drop.
for (const k of [1, 2, 3, 5, 8, 12])
  for (const r of [1, 2, 3])
    for (const shift of [0, -1])
      for (const rep of [0, 1])
        add(
          `rating-k${k}-r${r}-shift${shift}-${rep}`,
          4,
          draw(4, k, () => [r, r], 1.5, shift),
        );

// Ratings with mixed counts across cases, arm-unequal cells and one-trial cells.
for (const k of [5, 8, 12])
  for (const [name, trials] of [
    ["mixed", (i: number) => [2 + (i % 2), 2 + (i % 2)] as const],
    ["c3b2", () => [3, 2] as const],
    ["c2b3", () => [2, 3] as const],
    ["one-trial", (i: number) => (i === 0 ? ([1, 2] as const) : ([2, 2] as const))],
  ] as const)
    for (const shift of [0, -1])
      add(`rating-${name}-k${k}-shift${shift}`, 4, draw(4, k, trials, 1.5, shift));

// Proportions: m items per output, Y = passed / m, one denominator per table.
for (const m of [3, 5, 10, 20])
  for (const k of [2, 5, 8])
    for (const r of [2, 3])
      for (const shift of [0, -Math.ceil(m / 5)])
        add(
          `proportion-m${m}-k${k}-r${r}-shift${shift}`,
          m,
          draw(m, k, () => [r, r], m / 3, shift),
        );

// Proportions whose outputs have different item counts: the denominator is their lcm.
for (const ms of [
  [3, 4, 5],
  [2, 3, 7],
])
  for (const k of [3, 5])
    for (const shift of [0, -1]) {
      const d = ms.reduce((a, b) => (a * b) / gcdOf(a, b));
      const cases = Array.from({ length: k }, (_, i) => {
        const items = ms[i % ms.length] as number;
        const step = d / items;
        const centre = integer(0, items);
        return {
          candidate: Array.from({ length: 2 }, () => near(centre, 1, items, shift) * step),
          base: Array.from({ length: 2 }, () => near(centre, 1, items) * step),
        };
      });
      add(`proportion-items${ms.join("-")}-k${k}-shift${shift}`, d, cases);
    }

// A bimodal judge: 0, 0.5 or 1, mostly 0 or 1.
for (const k of [3, 5, 8, 12])
  for (const half of [0.1, 0.3])
    for (const r of [2, 3]) {
      const value = (bias: number): number => {
        const u = rng.uniform();
        return u < half ? 1 : u < half + (1 - half) * bias ? 2 : 0;
      };
      const cases = Array.from({ length: k }, () => {
        const bias = rng.uniform();
        return {
          candidate: Array.from({ length: r }, () => value(bias)),
          base: Array.from({ length: r }, () => value(bias)),
        };
      });
      add(`bimodal-k${k}-half${half}-r${r}`, 2, cases);
    }

// Larger suites of ratings, where only the convolution enumerates.
for (const k of [17, 30, 60, 146])
  for (const r of [2, 3])
    for (const shift of [0, -1])
      add(
        `rating-large-k${k}-r${r}-shift${shift}`,
        4,
        draw(4, k, () => [r, r], 1.5, shift * 0.3),
      );

// Edge tables.
add("edge-all-equal-within-each-case", 4, [
  { candidate: [3, 3], base: [3, 3] },
  { candidate: [0, 0], base: [0, 0] },
  { candidate: [4, 4, 4], base: [4, 4, 4] },
]);
add(
  "edge-all-cases-equal",
  4,
  Array.from({ length: 5 }, () => ({ candidate: [2, 3], base: [2, 3] })),
);
add(
  "edge-extremes-drop",
  1,
  Array.from({ length: 5 }, () => ({ candidate: [0, 0], base: [1, 1] })),
);
add(
  "edge-extremes-gain",
  1,
  Array.from({ length: 5 }, () => ({ candidate: [1, 1], base: [0, 0] })),
);
add("edge-zero-and-one-mixed", 1, [
  { candidate: [0, 1], base: [1, 1] },
  { candidate: [1, 0], base: [0, 1] },
  { candidate: [0, 0], base: [1, 0] },
  { candidate: [1, 1], base: [1, 1] },
  { candidate: [0, 1, 1], base: [1, 1, 1] },
]);
add("edge-one-trial-cells", 4, [
  { candidate: [1], base: [3] },
  { candidate: [2], base: [2, 4] },
  { candidate: [4, 0], base: [1] },
  { candidate: [3, 3], base: [4, 4] },
  { candidate: [0], base: [0] },
]);
add("edge-one-case-one-trial", 4, [{ candidate: [1], base: [3] }]);
add("edge-k5-single-noisy-case", 4, [
  { candidate: [4, 4], base: [4, 4] },
  { candidate: [4, 4], base: [4, 4] },
  { candidate: [4, 4], base: [4, 4] },
  { candidate: [4, 4], base: [4, 4] },
  { candidate: [0, 2], base: [4, 3] },
]);
add("edge-ties-across-cases", 2, [
  { candidate: [0, 2], base: [1, 1] },
  { candidate: [2, 0], base: [1, 1] },
  { candidate: [1, 1], base: [0, 2] },
  { candidate: [1, 2], base: [2, 1] },
  { candidate: [0, 1], base: [1, 0] },
]);

// Values off every small lattice (multiples of 1e-6): the test runs Monte Carlo, the oracles
// enumerate. Small, so that brute force stays cheap.
for (const k of [2, 3, 4])
  for (const shift of [0, -150_000])
    for (const rep of [0, 1])
      add(
        `continuous-k${k}-shift${shift}-${rep}`,
        1_000_000,
        draw(1_000_000, k, () => [2, 2], 300_000, shift),
      );

// Scores rounded to 2 and 3 decimals: the exact path at fine lattices, D = 100 and D = 1,000.
for (const k of [3, 5, 8, 12])
  for (const r of [2, 3])
    for (const shift of [0, -10])
      add(
        `decimal2-k${k}-r${r}-shift${shift}`,
        100,
        draw(100, k, () => [r, r], 30, shift),
      );
for (const k of [3, 5, 8, 12, 20])
  for (const r of [2, 3])
    for (const shift of [0, -50])
      add(
        `decimal3-k${k}-r${r}-shift${shift}`,
        1000,
        draw(1000, k, () => [r, r], 300, shift),
      );
for (const k of [12, 30])
  for (const shift of [0, -50])
    add(
      `decimal3-r1-k${k}-shift${shift}`,
      1000,
      draw(1000, k, () => [1, 1], 300, shift),
    );
for (const [name, trials] of [
  ["c3b2", () => [3, 2] as const],
  ["c1b3", () => [1, 3] as const],
] as const)
  add(`decimal3-${name}-k8`, 1000, draw(1000, 8, trials, 300, -50));

// A case with no completed trial in an arm does not enter the test.
add("edge-empty-arm", 4, [
  { candidate: [4, 3], base: [2, 3] },
  { candidate: [], base: [1, 2] },
  { candidate: [2, 3], base: [] },
  { candidate: [1, 4], base: [3, 3] },
]);

function gcdOf(a: number, b: number): number {
  return b === 0 ? a : gcdOf(b, a % b);
}

writeFileSync(
  new URL("../../test/stats/reference-score-permutation-tables.json", import.meta.url),
  `${JSON.stringify({ seed: 20261116, tables })}\n`,
);
console.log(`${tables.length} tables`);
