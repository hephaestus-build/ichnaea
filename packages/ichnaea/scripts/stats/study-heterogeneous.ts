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
//   node scripts/study-heterogeneous.ts <from> <to> <step> <worker> <workers> [<cases>] \
//     --out sweep-<worker>.tsv
// The TSV has the same bytes as the standard output of the script's first version (sha256
// 3496e34c…f374) at the same arguments, when no option below but --out is given.
//
// Options:
//   --out F         the TSV. F must not exist yet. Its sidecar F.meta.json records the commit, the
//                   sha256 of this script and of every local module it imports, the seed base and
//                   the arguments (scripts/provenance.ts). The script refuses to run when a tracked
//                   file has uncommitted changes.
//   --seed-base B   each margin's seed is B + round(margin × 10,000), on MT19937. The default 1
//                   gives the seeds of the first two sweeps (501 to 3,001). Another base gives an
//                   independent search: the confirmation uses 1,000,000 (seeds 1,000,500 to
//                   1,003,000) and the extra seed set at 12 and 17 cases 2,000,000. Every seed must
//                   be at most 2^32 − 1.
//   --skip-log F    writes every structure skipped for cost to F, one JSON line each: its id, the
//                   margin, k, r, the cell, the phase, the margin's seed and the full groups, which
//                   scripts/simulate-structures.ts reads. F must not exist yet and gets its own
//                   sidecar. The log changes neither the random stream nor the TSV.
//   --one-trial     adds the one-trial-cell family: up to 10% of case-arm cells (⌊k/5⌋ of 2k) run
//                   1 trial, the others 2 or 3. Phase 1 adds two grids, with every one-trial cell
//                   in the candidate arm or every one in the base arm of stable cases (2-trial
//                   cases first). Phase 2 adds 1,000 random structures after the 1,500, each with
//                   1 to ⌊k/5⌋ one-trial cells on stable cases in either arm, and in a quarter of
//                   them one on the last noisy case. Their cell reads "<k>|<r>+1t", and the TSV
//                   gains a column one_trial ("c<candidate cells>b<base cells>", plus "n<arm>" for
//                   the last noisy case). Phase 3 then refines around these structures too.
//   --count         evaluates nothing and writes no file: prints per margin how many structures
//                   phases 1 and 2 would evaluate and skip, and times --sample N of them (default
//                   10) to predict the margin's run time. Phase 3 counts as 500 structures at the
//                   margin's mean time.
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { createRng, type Rng } from "../../src/stats/rng.ts";
import { exactGroupCoverage, type Group, truthOfGroups } from "../../test/stats/support/exact.ts";
import { provenance, writeMeta } from "./provenance.ts";

/** Number of outcome multisets the enumeration visits. */
export function cost(groups: readonly Group[]): number {
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

/** Case-arm cells with one trial: stable cases per arm, and optionally the last noisy case. */
export interface OneTrial {
  readonly candidate: number;
  readonly base: number;
  readonly lastNoisy?: "candidate" | "base";
}

export interface Structure {
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
  /** Only in the one-trial family: the cells that run one trial. */
  readonly oneTrial?: OneTrial;
}

const unit = (x: number): number => Math.min(1, Math.max(0, x));

/** The most one-trial cells a structure may have: 10% of its 2k case-arm cells. */
export const maxOneTrial = (k: number): number => Math.floor(k / 5);

/**
 * Moves `o.candidate + o.base` stable cases, taken from the groups in order, to groups whose
 * candidate or base arm runs one trial. Without `o` the groups are returned as they are.
 */
function withOneTrial(groups: Group[], o: OneTrial | undefined): Group[] {
  if (!o) return groups;
  const left = groups.map((g) => g.count);
  const moved: Group[] = [];
  for (const [arm, wanted] of [
    ["candidate", o.candidate],
    ["base", o.base],
  ] as const) {
    let need = wanted;
    groups.forEach((g, i) => {
      const take = Math.min(need, left[i] as number);
      if (take === 0) return;
      left[i] = (left[i] as number) - take;
      need -= take;
      moved.push({
        ...g,
        count: take,
        ...(arm === "candidate" ? { candidateTrials: 1 } : { baseTrials: 1 }),
      });
    });
    if (need > 0) throw new RangeError("more one-trial cells than stable cases");
  }
  return [
    ...groups.map((g, i) => ({ ...g, count: left[i] as number })).filter((g) => g.count > 0),
    ...moved,
  ];
}

/**
 * The groups of a structure at a margin: the noisy cases, the last noisy case solved so the mean
 * is exactly -margin, then the stable cases. Undefined when the last case's candidate rate falls
 * outside [0, 1], or the enumeration would visit more than `maxCost` multisets.
 */
export function groupsOf(s: Structure, margin: number, maxCost = 20_000): Group[] | undefined {
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
  const stableGroups = withOneTrial(
    [
      stable(stableCount - atThree, stableTrials),
      ...(atThree > 0 ? [stable(atThree, 3)] : []),
    ].filter((g) => g.count > 0),
    s.oneTrial,
  );
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
  const lastNoisy = s.oneTrial?.lastNoisy;
  const groups = [
    ...others,
    {
      count: 1,
      base: s.lastBase,
      candidate: last,
      baseTrials: lastNoisy === "base" ? 1 : lastTrials,
      candidateTrials: lastNoisy === "candidate" ? 1 : lastTrials,
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

/** A random set of one-trial cells: 1 to ⌊k/5⌋, on stable cases, and a quarter on the last noisy. */
export function oneTrialOf(k: number, u: () => number): OneTrial {
  const total = 1 + Math.floor(u() * maxOneTrial(k));
  const lastNoisy = u() < 0.25 ? (u() < 0.5 ? "candidate" : "base") : undefined;
  let candidate = 0;
  for (let i = lastNoisy ? 1 : 0; i < total; i++) if (u() < 0.5) candidate++;
  const base = total - (lastNoisy ? 1 : 0) - candidate;
  return { candidate, base, ...(lastNoisy ? { lastNoisy } : {}) };
}

const oneTrialText = (o: OneTrial | undefined): string =>
  o ? `c${o.candidate}b${o.base}${o.lastNoisy ? `n${o.lastNoisy}` : ""}` : "-";

/** The grid's one-trial variants: none, and in the one-trial family every cell in one arm. */
const oneTrialGrid = (k: number, oneTrial: boolean): Array<OneTrial | undefined> =>
  oneTrial
    ? [undefined, { candidate: maxOneTrial(k), base: 0 }, { candidate: 0, base: maxOneTrial(k) }]
    : [undefined];

/** The cell a structure counts in: "<k>|<r>", with "+1t" in the one-trial family. */
export const cellOf = (s: Structure): string => `${s.k}|${s.r}${s.oneTrial ? "+1t" : ""}`;

function describe(s: Structure, margin: number, oneTrial: boolean): string {
  const groups = groupsOf(s, margin, Number.POSITIVE_INFINITY) as Group[];
  const noisy = groups
    .slice(0, s.noisy.length + 1)
    .map(
      (g) =>
        `${g.base.toFixed(4)}->${g.candidate.toFixed(4)}@${g.baseTrials}${g.candidateTrials === g.baseTrials ? "" : `/${g.candidateTrials}`}`,
    )
    .join(",");
  return [
    s.k,
    s.r,
    s.noisy.length + 1,
    s.stableBase,
    unit(s.stableBase - s.drop).toFixed(4),
    s.r === "2/3" ? s.stableAtThree : 0,
    noisy,
    ...(oneTrial ? [oneTrialText(s.oneTrial)] : []),
  ].join("\t");
}

type Phase = "grid" | "random" | "refine";

/** One skipped structure, as a line of the skip log. */
export function skipRecord(
  id: string,
  margin: number,
  s: Structure,
  phase: Phase,
  seed: number,
  groups: readonly Group[],
): string {
  return JSON.stringify({ id, margin, k: s.k, r: s.r, cell: cellOf(s), phase, seed, groups });
}

interface Options {
  readonly cases: readonly number[];
  readonly seedBase: number;
  readonly oneTrial: boolean;
  readonly count: boolean;
  readonly sample: number;
  readonly skipLog: string | undefined;
  readonly emit: (line: string) => void;
}

/** The --count mode's tally of one margin. */
interface Tally {
  readonly evaluated: Record<Phase, number>;
  readonly skipped: Record<Phase, number>;
  readonly costs: Array<{ groups: Group[]; work: number }>;
}

function sweep(margin: number, o: Options): void {
  const CASES = o.cases;
  const seed = o.seedBase + Math.round(margin * 10_000);
  const rng: Rng = createRng(seed);
  const u = (): number => rng.uniform();
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(u() * xs.length)] as T;
  const worst: Array<{ s: Structure; coverage: number }> = [];
  const worstByCell = new Map<string, { s: Structure; coverage: number }>();
  let evaluated = 0;
  let skipped = 0;
  const skippedByCell = new Map<string, number>();
  let phase: Phase = "grid";
  const tally: Tally = {
    evaluated: { grid: 0, random: 0, refine: 0 },
    skipped: { grid: 0, random: 0, refine: 0 },
    costs: [],
  };
  const evaluate = (s: Structure): void => {
    const groups = groupsOf(s, margin);
    const cell = cellOf(s);
    if (!groups) {
      const full = groupsOf(s, margin, Number.POSITIVE_INFINITY);
      if (full) {
        skipped++;
        tally.skipped[phase]++;
        const key = `${cell}|${s.noisy.length + 1}`;
        skippedByCell.set(key, (skippedByCell.get(key) ?? 0) + 1);
        if (o.skipLog !== undefined)
          appendFileSync(
            o.skipLog,
            `${skipRecord(`h${o.seedBase}-${margin.toFixed(3)}-${skipped}`, margin, s, phase, seed, full)}\n`,
          );
      }
      return;
    }
    if (o.count) {
      tally.evaluated[phase]++;
      tally.costs.push({ groups, work: cost(groups) * s.k });
      return;
    }
    const coverage = exactGroupCoverage(groups);
    evaluated++;
    if ((worstByCell.get(cell)?.coverage ?? 2) > coverage) worstByCell.set(cell, { s, coverage });
    worst.push({ s, coverage });
    worst.sort((a, b) => a.coverage - b.coverage);
    worst.length = Math.min(worst.length, 5);
  };
  // 1. The grid over one noisy case, with equal and with mixed trial counts, and in the one-trial
  // family again with every one-trial cell in the candidate arm, then in the base arm.
  for (const k of CASES)
    for (const oneTrial of oneTrialGrid(k, o.oneTrial))
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
                    ...(oneTrial ? { oneTrial } : {}),
                  });
  // 2. Random structures, and in the one-trial family 1,000 more with one-trial cells.
  phase = "random";
  for (let i = 0; i < 1500 + (o.oneTrial ? 1000 : 0); i++) {
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
      ...(i >= 1500 ? { oneTrial: oneTrialOf(k, u) } : {}),
    });
  }
  if (o.count) {
    report(margin, tally, o);
    return;
  }
  // 3. Refinement around the worst.
  phase = "refine";
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
    o.emit(
      [
        margin.toFixed(3),
        rank,
        w.coverage.toFixed(5),
        evaluated,
        skipped,
        describe(w.s, margin, o.oneTrial),
      ].join("\t"),
    );
  }
  for (const [cell, count] of [...skippedByCell.entries()].toSorted(([a], [b]) =>
    a.localeCompare(b, undefined, { numeric: true }),
  ))
    o.emit([margin.toFixed(3), "skip", count, evaluated, skipped, ...cell.split("|")].join("\t"));
}

/**
 * Prints the --count tally of one margin. Times evenly spaced structures and predicts the margin's
 * time from their seconds per unit of work (multisets × cases).
 */
function report(margin: number, t: Tally, o: Options): void {
  const n = t.costs.length;
  const size = Math.min(o.sample, n);
  const sample = Array.from({ length: size }, (_, i) => t.costs[Math.floor((i * n) / size)]);
  let seconds = 0;
  let work = 0;
  for (const c of sample) {
    if (!c) continue;
    const start = performance.now();
    exactGroupCoverage(c.groups);
    seconds += (performance.now() - start) / 1000;
    work += c.work;
  }
  const total = t.costs.reduce((a, c) => a + c.work, 0) * (work > 0 ? seconds / work : 0);
  const refine = n > 0 ? (500 * total) / n : 0;
  o.emit(
    [
      margin.toFixed(3),
      t.evaluated.grid,
      t.skipped.grid,
      t.evaluated.random,
      t.skipped.random,
      500,
      size,
      seconds.toFixed(2),
      (total + refine).toFixed(0),
    ].join("\t"),
  );
}

function main(): void {
  const args = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      out: { type: "string" },
      "seed-base": { type: "string", default: "1" },
      "skip-log": { type: "string" },
      "one-trial": { type: "boolean", default: false },
      count: { type: "boolean", default: false },
      sample: { type: "string", default: "10" },
    },
  });
  const [
    fromArg = "0.06",
    toArg = "0.06",
    stepArg = "0.005",
    workerArg = "0",
    workersArg = "1",
    casesArg = "5,6,7,8,9,10,12",
  ] = positionals;
  const from = Number(fromArg);
  const to = Number(toArg);
  const step = Number(stepArg);
  const worker = Number(workerArg);
  const workers = Number(workersArg);
  const seedBase = Number(values["seed-base"]);
  if (
    !Number.isInteger(seedBase) ||
    seedBase < 0 ||
    seedBase + Math.round(to * 10_000) > 2 ** 32 - 1
  )
    throw new RangeError(`--seed-base must keep every seed in [1, 2^32 - 1], got ${seedBase}`);
  const { out, count } = values;
  const skipLog = values["skip-log"];
  if (count && (out !== undefined || skipLog !== undefined))
    throw new Error("--count writes no file; leave out --out and --skip-log");
  if (!count && out === undefined) throw new Error("give the TSV with --out");
  if (out !== undefined && skipLog !== undefined && path.resolve(out) === path.resolve(skipLog))
    throw new Error("--out and --skip-log name the same file; give two files");
  for (const file of [out, skipLog])
    if (file !== undefined && existsSync(file))
      throw new Error(`${file} exists already; give a new file`);
  const options: Omit<Options, "emit"> = {
    // The case counts searched; the random phase also draws from these.
    cases: casesArg.split(",").map(Number),
    seedBase,
    oneTrial: values["one-trial"],
    count,
    sample: Number(values.sample),
    skipLog,
  };
  const p = count
    ? undefined
    : provenance(
        import.meta.filename,
        [
          path.join(import.meta.dirname, "../../test/stats/support/exact.ts"),
          path.join(import.meta.dirname, "provenance.ts"),
        ],
        seedBase,
        args,
      );
  const emit =
    out === undefined
      ? (line: string) => console.log(line)
      : (line: string) => appendFileSync(out, `${line}\n`);
  const seeds = {
    rule: `${seedBase} + round(margin × 10,000), MT19937`,
    first: seedBase + Math.round(from * 10_000),
    last: seedBase + Math.round(to * 10_000),
  };
  const sweepMeta = { kind: "sweep", cases: options.cases, oneTrial: options.oneTrial, seeds };
  const skipMeta = { ...sweepMeta, kind: "skip-log" };
  if (out !== undefined && p) {
    writeFileSync(out, "");
    writeMeta(out, p, false, sweepMeta);
  }
  if (skipLog !== undefined && p) {
    writeFileSync(skipLog, "");
    writeMeta(skipLog, p, false, skipMeta);
  }
  emit(
    count
      ? "margin\tgrid_evaluated\tgrid_skipped\trandom_evaluated\trandom_skipped\trefine_steps\tsampled\tsample_seconds\tpredicted_seconds"
      : `margin\trank\tcoverage\tevaluated\tskipped\tk\tr\tnoisy\tstable_base\tstable_candidate\tstable_at_three\tnoisy_rates@trials${options.oneTrial ? "\tone_trial" : ""}`,
  );
  const margins = Math.round((to - from) / step) + 1;
  for (let i = worker; i < margins; i += workers) sweep(from + i * step, { ...options, emit });
  if (out !== undefined && p) writeMeta(out, p, true, sweepMeta);
  if (skipLog !== undefined && p) writeMeta(skipLog, p, true, skipMeta);
}

if (import.meta.main) main();
