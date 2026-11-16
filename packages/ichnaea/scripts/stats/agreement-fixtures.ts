// Writes test/stats/reference-agreement-inputs.json: the synthetic tables, label pairs and
// reliability matrices that the agreement oracle (reference-agreement.R) and the tests read. Deterministic: run it again and the file does not change.
//   node scripts/stats/agreement-fixtures.ts
import { writeFileSync } from "node:fs";

import { createRng } from "../../src/stats/rng.ts";

const rng = createRng(20261117);
const int = (n: number): number => Math.floor(rng.uniform() * n);

// Named tables with a known shape. The two Feinstein–Cicchetti-style tables share raw agreement
// 0.85 but differ in prevalence, which moves kappa and AC1 differently.
const tables: { id: string; table: number[][] }[] = [
  {
    id: "balanced-0.85",
    table: [
      [40, 9],
      [6, 45],
    ],
  },
  {
    id: "skewed-0.85",
    table: [
      [80, 10],
      [5, 5],
    ],
  },
  {
    id: "rare-category",
    table: [
      [118, 5],
      [2, 0],
    ],
  },
  {
    id: "three-categories",
    table: [
      [20, 3, 1],
      [4, 15, 2],
      [0, 3, 12],
    ],
  },
  // Six declared categories (levels 1–5 and unknown), one of them never chosen: AC1 counts it.
  {
    id: "declared-unused",
    table: [
      [3, 1, 0, 0, 0, 0],
      [1, 5, 2, 0, 0, 1],
      [0, 2, 9, 3, 0, 0],
      [0, 0, 2, 14, 4, 0],
      [0, 0, 0, 3, 11, 0],
      [0, 0, 0, 0, 0, 0],
    ],
  },
];

// Seeded tables with 2–7 categories, 20–200 items, uneven margins and a stronger diagonal.
for (let t = 0; t < 30; t++) {
  const q = 2 + (t % 6);
  const n = 20 + int(181);
  const weight = Array.from({ length: q }, () => 0.2 + rng.uniform() * 3);
  const sum = weight.reduce((a, b) => a + b, 0);
  const table = Array.from({ length: q }, () => Array.from({ length: q }, () => 0));
  for (let item = 0; item < n; item++) {
    let u = rng.uniform() * sum;
    let i = 0;
    while (u > weight[i]! && i < q - 1) u -= weight[i++]!;
    const j = rng.uniform() < 0.7 ? i : int(q);
    table[i]![j]! += 1;
  }
  tables.push({ id: `seeded-${String(t + 1).padStart(2, "0")}`, table });
}

// Label pairs with missing labels, for the table builder.
const levels = ["1", "2", "3", "4", "5", "unknown"];
const pairs: {
  id: string;
  categories: string[];
  first: (string | null)[];
  second: (string | null)[];
}[] = [
  {
    id: "binary-with-missing",
    categories: ["yes", "no"],
    first: ["yes", "no", "no", null, "yes", "yes", "no", "no", "yes", null, "no", "no"],
    second: ["yes", "no", "yes", "no", null, "yes", "no", "no", "no", null, "no", "yes"],
  },
];
for (let p = 0; p < 4; p++) {
  const n = 40 + int(80);
  const first: (string | null)[] = [];
  const second: (string | null)[] = [];
  for (let item = 0; item < n; item++) {
    const a = int(levels.length);
    const b = rng.uniform() < 0.6 ? a : int(levels.length);
    first.push(rng.uniform() < 0.08 ? null : levels[a]!);
    second.push(rng.uniform() < 0.08 ? null : levels[b]!);
  }
  pairs.push({ id: `levels-${p + 1}`, categories: levels, first, second });
}

// Reliability matrices, one row per unit. The first is Krippendorff's published example: 12 units,
// 4 raters, values 1–5, with missing values (also the example of R's irr::kripp.alpha).
const reliability: { id: string; units: (number | null)[][] }[] = [
  {
    id: "krippendorff-2011",
    units: [
      [1, 1, null, 1],
      [2, 2, 3, 2],
      [3, 3, 3, 3],
      [3, 3, 3, 3],
      [2, 2, 2, 2],
      [1, 2, 3, 4],
      [4, 4, 4, 4],
      [1, 1, 2, 1],
      [2, 2, 2, 2],
      [null, 5, 5, 5],
      [null, null, 1, 1],
      [null, null, 3, null],
    ],
  },
];
for (let r = 0; r < 10; r++) {
  const raters = 2 + (r % 4);
  const count = 10 + int(51);
  const units: (number | null)[][] = [];
  for (let u = 0; u < count; u++) {
    const truth = 1 + int(5);
    units.push(
      Array.from({ length: raters }, () => {
        if (rng.uniform() < 0.1) return null;
        const shift = rng.uniform() < 0.65 ? 0 : rng.uniform() < 0.5 ? -1 : 1;
        return Math.min(5, Math.max(1, truth + shift));
      }),
    );
  }
  reliability.push({ id: `seeded-${String(r + 1).padStart(2, "0")}`, units });
}

writeFileSync(
  new URL("../../test/stats/reference-agreement-inputs.json", import.meta.url),
  `${JSON.stringify({ tables, pairs, reliability })}\n`,
);
