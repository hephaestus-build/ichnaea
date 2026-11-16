// The benchmark behind SCORE_PERMUTATION_WORK_LIMIT (VALIDATION.md, "Score measures: the regression
// test"): the exact path's time against its work estimate W, on tables shaped like real suites and
// on the worst shapes a review found. Prints one row per table and the time per unit of W.
//   node scripts/benchmark-score-permutation.ts
import { createRng, type Rng } from "../src/index.ts";
import {
  type CaseScores,
  exactPathIgnoringWork,
  exactWork,
} from "../src/score-permutation-core.ts";

/** Values on a lattice of step 1/d, near `centre` (0 to 1), `spread` wide. */
const value = (rng: Rng, d: number, centre: number, spread: number): number =>
  Math.min(d, Math.max(0, Math.round((centre + (rng.uniform() - 0.5) * spread) * d))) / d;

export interface BenchmarkTable {
  readonly name: string;
  readonly cases: CaseScores[];
}

/** The benchmark's tables, from one seed. */
export function benchmarkTables(): BenchmarkTable[] {
  const rng = createRng(20261117);
  const table = (
    name: string,
    k: number,
    nc: number,
    nb: number,
    d: number,
    spread: number,
    centre: (i: number) => [candidate: number, base: number] = () => [0.5, 0.5],
  ): BenchmarkTable => ({
    name,
    cases: Array.from({ length: k }, (_, i) => {
      const [c, b] = centre(i);
      return {
        id: `c${i}`,
        candidate: Array.from({ length: nc }, () => value(rng, d, c, spread)),
        base: Array.from({ length: nb }, () => value(rng, d, b, spread)),
      };
    }),
  });
  const out: BenchmarkTable[] = [];
  for (const k of [12, 30, 60, 146, 300])
    for (const r of [1, 2, 3]) out.push(table(`ratings k=${k} r=${r}`, k, r, r, 4, 1));
  for (const k of [30, 146]) out.push(table(`proportions of 20 k=${k} r=3`, k, 3, 3, 20, 1));
  for (const k of [12, 30, 60, 100, 146])
    for (const r of [2, 3]) out.push(table(`3-decimal k=${k} r=${r}`, k, r, r, 1000, 1));
  for (const k of [146, 300]) out.push(table(`3-decimal k=${k} r=1`, k, 1, 1, 1000, 1));
  for (const k of [20, 40, 78])
    out.push(table(`3-decimal extremes k=${k} r=9`, k, 9, 9, 1000, 0.1, () => [0.95, 0.05]));
  return out;
}

if (import.meta.main) {
  console.log("table\tW\tseconds\tns per W");
  for (const t of benchmarkTables()) {
    // Far past any limit: report W only, since timing it would take minutes.
    const work = exactWork(t.cases);
    if (work !== undefined && work > 2e9) {
      console.log(`${t.name}\t${work}\t(not timed)\t`);
      continue;
    }
    const start = performance.now();
    const result = exactPathIgnoringWork(t.cases);
    const seconds = (performance.now() - start) / 1000;
    if (result === undefined) continue;
    console.log(
      `${t.name}\t${result.work}\t${seconds.toFixed(3)}\t${((seconds * 1e9) / result.work).toFixed(2)}`,
    );
  }
}
