// Writes test/stats/reference-solver-snapshot.json: every bound that the root-finder gives the binary
// intervals on the reference inputs (ratesci's and R's sets), on each side, plus seeded random
// stratified tables, with the platform that computed them. It was written by the root-finder before it
// shared its scan and bisection with the score study's decision. V8's Math is not bit-identical across
// CPU architectures, so test/stats/solver-snapshot.test.ts compares the file only on the platform it
// records; on every platform it compares the current solver with a verbatim copy of the old one.
//   node scripts/stats/solver-snapshot.ts
import { readFileSync, writeFileSync } from "node:fs";

import {
  createRng,
  type Sided,
  scoreDifferenceInterval,
  type ScoreOptions,
  type Stratum,
  tangoInterval,
} from "../../src/stats/index.ts";

interface Strata {
  x1: number[];
  n1: number[];
  x2: number[];
  n2: number[];
}
const read = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../../test/stats/${name}`, import.meta.url), "utf8")) as T;
const ratesci = read<{
  difference: {
    x1: number;
    n1: number;
    x2: number;
    n2: number;
    level: number;
    skew: boolean;
    bcf: boolean;
  }[];
  stratified: (Strata & { level: number; skew: boolean; bcf: boolean })[];
  stratifiedEqual: (Strata & { level: number })[];
  tango: {
    both: number;
    candidateOnly: number;
    baseOnly: number;
    neither: number;
    level: number;
    skew: boolean;
  }[];
}>("reference-ratesci.json");
const extra = read<{ extremes: (Strata & { level: number })[] }>("reference-r-extra.json");

const strataOf = (s: Strata): Stratum[] =>
  s.x1.map((x1, k) => ({
    candidate: { successes: x1, trials: s.n1[k] as number },
    base: { successes: s.x2[k] as number, trials: s.n2[k] as number },
  }));

export interface SnapshotRow {
  readonly set: string;
  readonly index: number;
  readonly sided: Sided;
  readonly lower: number;
  readonly upper: number;
}

/** Every bound of the snapshot, from the current code. */
export function snapshotRows(): SnapshotRow[] {
  const rows: SnapshotRow[] = [];
  const sides: Sided[] = ["two", "lower", "upper"];
  const score = (
    set: string,
    index: number,
    strata: Stratum[],
    level: number,
    options: ScoreOptions,
  ): void => {
    for (const sided of sides) {
      const i = scoreDifferenceInterval(strata, level, sided, options);
      rows.push({ set, index, sided, lower: i.lower, upper: i.upper });
    }
  };
  ratesci.difference.forEach((r, i) =>
    score("difference", i, strataOf({ x1: [r.x1], n1: [r.n1], x2: [r.x2], n2: [r.n2] }), r.level, {
      skewnessCorrection: r.skew,
      biasCorrection: r.bcf,
    }),
  );
  ratesci.stratified.forEach((r, i) =>
    score("stratified", i, strataOf(r), r.level, {
      skewnessCorrection: r.skew,
      biasCorrection: r.bcf,
      weights: "mantel-haenszel",
    }),
  );
  ratesci.stratifiedEqual.forEach((r, i) => score("stratifiedEqual", i, strataOf(r), r.level, {}));
  extra.extremes.forEach((r, i) => score("extremes", i, strataOf(r), r.level, {}));
  ratesci.tango.forEach((r, i) => {
    for (const sided of sides) {
      const t = tangoInterval(r, r.level, sided, r.skew);
      rows.push({ set: "tango", index: i, sided, lower: t.lower, upper: t.upper });
    }
  });
  const rng = createRng(20261116);
  for (let i = 0; i < 500; i++) {
    const k = 1 + Math.floor(rng.uniform() * 30);
    const strata: Stratum[] = Array.from({ length: k }, () => {
      const n1 = 1 + Math.floor(rng.uniform() * 3);
      const n2 = 1 + Math.floor(rng.uniform() * 3);
      return {
        candidate: { successes: Math.floor(rng.uniform() * (n1 + 1)), trials: n1 },
        base: { successes: Math.floor(rng.uniform() * (n2 + 1)), trials: n2 },
      };
    });
    score("random", i, strata, [0.9, 0.95][i % 2] as number, {});
  }
  return rows;
}

if (import.meta.main) {
  const rows = snapshotRows();
  writeFileSync(
    new URL("../../test/stats/reference-solver-snapshot.json", import.meta.url),
    `${JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version, rows })}\n`,
  );
  console.log(`${rows.length} bounds`);
}
