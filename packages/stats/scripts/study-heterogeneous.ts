// Adversarial search for the fixed-cases lower bound under heterogeneous effects: most cases pass
// every base trial and drop under the candidate, and a few noisy cases offset the drops. Each
// structure is evaluated exactly (grouped enumeration) at a true mean difference of -margin.
//
// A deterministic sweep over margins. Every margin gets the same work, from a seed of its own:
//   1. a grid over one noisy case: the case counts given, 2 or 3 trials for every case or mixed
//      counts (2 trials on most cases, 3 on a quarter or half of the stable ones), stable base 1
//      (and 0.99 up to 6 cases), stable drop 0 to 0.30 in steps of 0.025, noisy base 0 to 1 in
//      steps of 0.1;
//   2. 1,500 random structures with 1 to 3 noisy cases and equal or mixed trial counts;
//   3. 500 refinement steps around the 5 worst structures found so far.
// Structures whose enumeration would visit more than 20,000 outcome multisets are skipped and
// counted, so each structure takes at most about a second.
// Usage, one process per worker, margins i ≡ worker (mod workers):
//   node scripts/study-heterogeneous.ts <from> <to> <step> <worker> <workers> > sweep-<worker>.tsv
import { createRng, type Rng } from "../src/index.ts";
import { exactGroupCoverage, type Group, truthOfGroups } from "../test/support/exact.ts";

const [
  fromArg = "0.06",
  toArg = "0.06",
  stepArg = "0.005",
  workerArg = "0",
  workersArg = "1",
  casesArg = "5,6,7,8,9,10,12",
] = process.argv.slice(2);
/** The case counts searched; the random phase also draws from these. */
const CASES = casesArg.split(",").map(Number);
const from = Number(fromArg);
const to = Number(toArg);
const step = Number(stepArg);
const worker = Number(workerArg);
const workers = Number(workersArg);

/** Number of outcome multisets the enumeration visits. */
function cost(groups: readonly Group[]): number {
  let total = 1;
  for (const g of groups) {
    const types =
      (g.candidate > 0 && g.candidate < 1 ? g.candidateTrials + 1 : 1) *
      (g.base > 0 && g.base < 1 ? g.baseTrials + 1 : 1);
    let c = 1;
    for (let i = 1; i < types; i++) c = (c * (g.count + i)) / i;
    total *= c;
  }
  return total;
}

interface Structure {
  readonly k: number;
  /** Trials per case and arm: 2 or 3 for every case, or "2/3" for mixed counts. */
  readonly r: 2 | 3 | "2/3";
  /** Under mixed counts: how many stable cases run 3 trials; the others run 2. */
  readonly stableAtThree: number;
  readonly stableBase: number;
  readonly drop: number;
  /** Base and candidate rates of every noisy case but the last. */
  readonly noisy: ReadonlyArray<readonly [number, number]>;
  /** Trials of each noisy case, the last one included. */
  readonly noisyTrials: readonly number[];
  /** Base rate of the last noisy case; its candidate rate makes the mean exactly -margin. */
  readonly lastBase: number;
}

const unit = (x: number): number => Math.min(1, Math.max(0, x));

function groupsOf(s: Structure, margin: number, maxCost = 20_000): Group[] | undefined {
  const stableCount = s.k - s.noisy.length - 1;
  const atThree = s.r === "2/3" ? s.stableAtThree : 0;
  const stableTrials = s.r === "2/3" ? 2 : s.r;
  const stable = (count: number, trials: number): Group => ({
    count,
    base: s.stableBase,
    candidate: unit(s.stableBase - s.drop),
    baseTrials: trials,
    candidateTrials: trials,
  });
  const stableGroups = [
    stable(stableCount - atThree, stableTrials),
    ...(atThree > 0 ? [stable(atThree, 3)] : []),
  ].filter((g) => g.count > 0);
  const others = s.noisy.map(([b, c], i): Group => {
    const trials = s.noisyTrials[i] as number;
    return { count: 1, base: b, candidate: c, baseTrials: trials, candidateTrials: trials };
  });
  const partial = [...stableGroups, ...others].reduce(
    (a, g) => a + g.count * (g.candidate - g.base),
    0,
  );
  const last = s.lastBase - margin * s.k - partial;
  if (last < 0 || last > 1) return undefined;
  const lastTrials = s.noisyTrials.at(-1) as number;
  const groups = [
    ...others,
    {
      count: 1,
      base: s.lastBase,
      candidate: last,
      baseTrials: lastTrials,
      candidateTrials: lastTrials,
    },
    ...stableGroups,
  ];
  if (Math.abs(truthOfGroups(groups) + margin) > 1e-9 || cost(groups) > maxCost) return undefined;
  return groups;
}

/** Equal trial counts of one value, or the mixed pattern. */
function trialsOf(k: number, r: 2 | 3 | "2/3", noisy: number, u: () => number) {
  if (r !== "2/3") return { stableAtThree: 0, noisyTrials: Array.from({ length: noisy }, () => r) };
  const stableCount = k - noisy;
  return {
    stableAtThree: Math.max(1, Math.round(u() * 0.6 * stableCount)),
    noisyTrials: Array.from({ length: noisy }, () => (u() < 0.5 ? 2 : 3)),
  };
}

function describe(s: Structure, margin: number): string {
  const groups = groupsOf(s, margin, Number.POSITIVE_INFINITY) as Group[];
  const noisy = groups
    .slice(0, s.noisy.length + 1)
    .map((g) => `${g.base.toFixed(4)}->${g.candidate.toFixed(4)}@${g.baseTrials}`)
    .join(",");
  return [
    s.k,
    s.r,
    s.noisy.length + 1,
    s.stableBase,
    unit(s.stableBase - s.drop).toFixed(4),
    s.r === "2/3" ? s.stableAtThree : 0,
    noisy,
  ].join("\t");
}

function sweep(margin: number): void {
  const rng: Rng = createRng(1 + Math.round(margin * 10_000));
  const u = (): number => rng.uniform();
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(u() * xs.length)] as T;
  const worst: Array<{ s: Structure; coverage: number }> = [];
  const worstByCell = new Map<string, { s: Structure; coverage: number }>();
  let evaluated = 0;
  let skipped = 0;
  const skippedByCell = new Map<string, number>();
  const evaluate = (s: Structure): void => {
    const groups = groupsOf(s, margin);
    const cell = `${s.k}|${s.r}`;
    if (!groups) {
      if (groupsOf(s, margin, Number.POSITIVE_INFINITY)) {
        skipped++;
        const key = `${cell}|${s.noisy.length + 1}`;
        skippedByCell.set(key, (skippedByCell.get(key) ?? 0) + 1);
      }
      return;
    }
    const coverage = exactGroupCoverage(groups);
    evaluated++;
    if ((worstByCell.get(cell)?.coverage ?? 2) > coverage) worstByCell.set(cell, { s, coverage });
    worst.push({ s, coverage });
    worst.sort((a, b) => a.coverage - b.coverage);
    worst.length = Math.min(worst.length, 5);
  };
  // 1. The grid over one noisy case, with equal and with mixed trial counts.
  for (const k of CASES)
    for (const r of [2, 3, "2/3"] as const)
      for (const stableBase of k <= 6 ? [1, 0.99] : [1])
        for (const atThreeShare of r === "2/3" ? [0.25, 0.5] : [0])
          for (const lastTrials of r === "2/3" ? [2, 3] : [r])
            for (let d = 0; d <= 12; d++)
              for (let b = 0; b <= 10; b++)
                evaluate({
                  k,
                  r,
                  stableAtThree: Math.max(1, Math.round(atThreeShare * (k - 1))),
                  stableBase,
                  drop: d * 0.025,
                  noisy: [],
                  noisyTrials: [lastTrials],
                  lastBase: b / 10,
                });
  // 2. Random structures.
  for (let i = 0; i < 1500; i++) {
    const noisy = pick([1, 2, 3]);
    const k = pick(CASES);
    const r = pick([2, 3, "2/3"] as const);
    evaluate({
      k,
      r,
      ...trialsOf(k, r, noisy, u),
      stableBase: pick([1, 1, 1, 0.99, 0.97]),
      drop: u() * 0.3,
      noisy: Array.from({ length: noisy - 1 }, () => [u(), u()] as const),
      lastBase: u(),
    });
  }
  // 3. Refinement around the worst.
  for (let i = 0; i < 500 && worst.length > 0; i++) {
    const s = pick(worst).s;
    const nudge = (x: number): number => unit(x + (u() - 0.5) * 0.06);
    evaluate({
      ...s,
      drop: Math.max(0, s.drop + (u() - 0.5) * 0.04),
      noisy: s.noisy.map(([b, c]) => [nudge(b), nudge(c)] as const),
      lastBase: nudge(s.lastBase),
    });
  }
  const rows = [
    ...worst.map((w, i) => [String(i + 1), w] as const),
    ...[...worstByCell.entries()]
      .toSorted(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([cell, w]) => [`k${cell}`, w] as const),
  ];
  for (const [rank, w] of rows) {
    console.log(
      [
        margin.toFixed(3),
        rank,
        w.coverage.toFixed(5),
        evaluated,
        skipped,
        describe(w.s, margin),
      ].join("\t"),
    );
  }
  for (const [cell, count] of [...skippedByCell.entries()].toSorted(([a], [b]) =>
    a.localeCompare(b, undefined, { numeric: true }),
  ))
    console.log(
      [margin.toFixed(3), "skip", count, evaluated, skipped, ...cell.split("|")].join("\t"),
    );
}

console.log(
  "margin\trank\tcoverage\tevaluated\tskipped\tk\tr\tnoisy\tstable_base\tstable_candidate\tstable_at_three\tnoisy_rates@trials",
);
const margins = Math.round((to - from) / step) + 1;
for (let i = worker; i < margins; i += workers) sweep(from + i * step);
