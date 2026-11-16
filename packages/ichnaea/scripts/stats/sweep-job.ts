// One job of the confirmation sweep on GitHub Actions (.github/workflows/confirmation-sweep.yml),
// and the plan of its job matrices. Each job runs the study scripts with the arguments and seed
// bases of the confirmation run, and writes job.json next to their outputs: the commit, the runner
// image, the Node version and the seeds of its shard. scripts/collect-sweep.ts checks the outputs
// of every job. scripts/README.md says how to dispatch and verify the sweep.
//
// Commands, each writing into --out (a new or empty directory):
//   plan [--margins i,j]         reads the workflow's phase inputs (SWEEP_A, SWEEP_B, SWEEP_C,
//                                SWEEP_D, SWEEP_E_LARGE, SWEEP_E_EMBEDDED: "true" or "false")
//                                and appends the job matrices, their sizes and the margins to
//                                $GITHUB_OUTPUT. --margins runs a subset, for example the pre-check
//                                of one margin before the full sweep.
//   exact --phase P --margin i   phase A, B or C at margin index i, as worker i of 51.
//   structures                   the large suites of scripts/generate-structures.ts --one-trial,
//                                which must have the sha256 GENERATOR_SHA256.
//   embed --in R                 scripts/embed-worst.ts on phase B's TSVs from the artifacts in R.
//   simulate --set S --job j --in R
//                                processes 4j to 4j + 3 of the set's shards of
//                                scripts/simulate-structures.ts, on the inputs in R.
// For a local dry run, --margins i,j also limits the margins of the other commands, and --jobs n
// the jobs per set. The rows of
// a structure depend only on its index and the seed base, not on the shard, so --jobs changes no
// row.
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { git, repoRoot, sha256 } from "./provenance.ts";
import { readStructures, seedOf, shardOf } from "./simulate-structures.ts";

export const JOB_SCHEMA = "ichnaea.sweep-job/1";

/** The margins: 0.050 to 0.300 in steps of 0.005, as the sweep's positional arguments. */
export const MARGIN_ARGS = ["0.05", "0.30", "0.005"] as const;
export const MARGINS = 51;
/** The margin at index i, as the sweep computes and prints it. */
export const marginText = (i: number): string =>
  (Number(MARGIN_ARGS[0]) + i * Number(MARGIN_ARGS[2])).toFixed(3);

export type ExactPhase = "A" | "B" | "C";
export type SimulationSet = "D-A" | "D-B" | "D-C" | "E-large" | "E-embedded";
export type Phase = ExactPhase | "D" | "E-large" | "E-embedded";
export const PHASES: readonly Phase[] = ["A", "B", "C", "D", "E-large", "E-embedded"];

/** The exact phases, with the arguments of the confirmation run on the server. */
export const EXACT: Readonly<
  Record<ExactPhase, { cases: string; options: readonly string[]; seedBase: number }>
> = {
  // The second sweep's replica: its default seed base 1, given as on the server (no option).
  A: { cases: "9,10,11,12,14,17", options: [], seedBase: 1 },
  B: {
    cases: "11,12,13,14,15,16,17",
    options: ["--seed-base", "1000000", "--one-trial"],
    seedBase: 1_000_000,
  },
  C: { cases: "12,17", options: ["--seed-base", "2000000"], seedBase: 2_000_000 },
};

/** The simulation sets. `jobs` × PROCESSES shards; the shard count changes no row. */
export const SIMULATIONS: Readonly<
  Record<
    SimulationSet,
    { input: ExactPhase | "structures" | "embedded"; seedBase: number; minK?: number; jobs: number }
  >
> = {
  "D-A": { input: "A", seedBase: 10_000_000, minK: 11, jobs: 4 },
  "D-B": { input: "B", seedBase: 11_000_000, jobs: 16 },
  "D-C": { input: "C", seedBase: 12_000_000, jobs: 4 },
  "E-large": { input: "structures", seedBase: 20_000_000, jobs: 32 },
  "E-embedded": { input: "embedded", seedBase: 21_000_000, jobs: 2 },
};
export const PROCESSES = 4;

/** The sha256 of the large suites that scripts/generate-structures.ts --one-trial writes. */
export const GENERATOR_SHA256 = "e81bb2a42338b32799dd86b5ba808b2872fcbdc83cfee8ab75e6a4cf6f853ae9";

/**
 * The server ran each exact phase as 4 workers, worker w taking the margins i ≡ w (mod 4), and
 * passed the skip logs to the runner as worker 0 to 3. A structure's seed is its index over the
 * inputs, so the runner reads the per-margin skip logs in that order to give every structure the
 * server's seed.
 */
export const SERVER_WORKERS = 4;
export const serverOrder = (margins: readonly number[]): number[] =>
  margins.toSorted((a, b) => (a % SERVER_WORKERS) - (b % SERVER_WORKERS) || a - b);

/**
 * Artifact names, each starting with "sweep-" so that the collector downloads only these; the
 * workflow names the structures and the embedding artifacts the same way. The collector reads
 * them back from a directory of downloaded artifacts, one directory each.
 */
export const exactName = (p: ExactPhase, i: number): string => `sweep-exact-${p}-${marginText(i)}`;
export const simulationName = (s: SimulationSet, job: number): string =>
  `sweep-sim-${s}-${String(job).padStart(2, "0")}`;
const exactBase = (p: ExactPhase, i: number): string => `${p}-${marginText(i)}`;
export const exactFiles = (
  root: string,
  p: ExactPhase,
  i: number,
): { dir: string; tsv: string; skips: string } => {
  const dir = path.join(root, exactName(p, i));
  const base = exactBase(p, i);
  return { dir, tsv: path.join(dir, `${base}.tsv`), skips: path.join(dir, `${base}.skips.jsonl`) };
};
export const structuresFile = (root: string): string =>
  path.join(root, "sweep-structures", "structures.jsonl");
export const embeddedFile = (root: string): string =>
  path.join(root, "sweep-embedded", "embedded.jsonl");
const simulationBase = (s: SimulationSet, worker: number): string =>
  `${s}-${String(worker).padStart(3, "0")}.tsv`;
export const simulationFile = (
  root: string,
  s: SimulationSet,
  job: number,
  worker: number,
): string => path.join(root, simulationName(s, job), simulationBase(s, worker));

const isSet = (s: string | undefined): s is SimulationSet => s !== undefined && s in SIMULATIONS;

/** The selected phases. Throws on an unknown phase or a phase whose inputs are not selected. */
export function parsePhases(text: string): Phase[] {
  const chosen = text
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  for (const p of chosen)
    if (!(PHASES as readonly string[]).includes(p)) throw new Error(`unknown phase ${p}`);
  const has = (p: Phase): boolean => chosen.includes(p);
  if (has("D") && !(has("A") && has("B") && has("C")))
    throw new Error("phase D simulates the skips of A, B and C, so it needs all three");
  if (has("E-embedded") && !has("B"))
    throw new Error("phase E-embedded embeds the worst structures of B, so it needs B");
  if (chosen.length === 0) throw new Error("select at least one phase");
  return PHASES.filter(has);
}

/** The simulation sets of the selected phases. */
export const setsOf = (phases: readonly Phase[]): SimulationSet[] =>
  (Object.keys(SIMULATIONS) as SimulationSet[]).filter((s) =>
    phases.includes(s.startsWith("D-") ? "D" : (s as Phase)),
  );

export interface ExactJob {
  readonly phase: ExactPhase;
  readonly margin: number;
  readonly artifact: string;
}
export interface SimulationJob {
  readonly set: SimulationSet;
  readonly job: number;
  readonly artifact: string;
}
export interface Plan {
  readonly phases: string;
  /** The margin indices, comma-separated, for the collector's `--margins`. */
  readonly margins: string;
  readonly exact: { readonly include: readonly ExactJob[] };
  readonly skips: { readonly include: readonly SimulationJob[] };
  readonly large: { readonly include: readonly SimulationJob[] };
  readonly embedded: { readonly include: readonly SimulationJob[] };
}

/** GitHub runs at most 256 jobs from one matrix. */
export const MAX_MATRIX_JOBS = 256;

/**
 * The job matrices of the selected phases, as `include` lists. A subset of the margins runs only
 * the exact phases and the large suites: phase D reads the skips of every margin in the server's
 * order, and phase E-embedded takes the worst structures of every margin, so a subset would change
 * their seeds and rows.
 */
export function plan(
  phases: readonly Phase[],
  margins: readonly number[] = range(MARGINS),
  jobs?: number,
): Plan {
  if (margins.length < MARGINS && phases.some((p) => p === "D" || p === "E-embedded"))
    throw new Error(
      "phases D and E-embedded need every margin; select a subset only for A, B, C and E-large",
    );
  const exactJobs = (["A", "B", "C"] as const)
    .filter((p) => phases.includes(p))
    .flatMap((phase) =>
      margins.map((margin) => ({ phase, margin, artifact: exactName(phase, margin) })),
    );
  const sims = (filter: (s: SimulationSet) => boolean): SimulationJob[] =>
    setsOf(phases)
      .filter(filter)
      .flatMap((set) =>
        range(jobs ?? SIMULATIONS[set].jobs).map((job) => ({
          set,
          job,
          artifact: simulationName(set, job),
        })),
      );
  const p: Plan = {
    phases: phases.join(","),
    margins: margins.join(","),
    exact: { include: exactJobs },
    skips: { include: sims((s) => s.startsWith("D-")) },
    large: { include: sims((s) => s === "E-large") },
    embedded: { include: sims((s) => s === "E-embedded") },
  };
  for (const [name, m] of Object.entries(p))
    if (typeof m !== "string" && m.include.length > MAX_MATRIX_JOBS)
      throw new Error(
        `the ${name} matrix has ${m.include.length} jobs; GitHub runs at most ${MAX_MATRIX_JOBS}`,
      );
  return p;
}

export const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** The inputs of a simulation set, in the order that gives each structure its seed. */
export function simulationInputs(
  root: string,
  set: SimulationSet,
  margins: readonly number[] = range(MARGINS),
): string[] {
  const { input } = SIMULATIONS[set];
  if (input === "structures") return [structuresFile(root)];
  if (input === "embedded") return [embeddedFile(root)];
  return serverOrder(margins).map((i) => exactFiles(root, input, i).skips);
}

/** The shards of job `job`: workers PROCESSES·job to PROCESSES·job + PROCESSES − 1. */
export const workersOf = (job: number): number[] =>
  range(PROCESSES).map((p) => PROCESSES * job + p);

/** What a job records about where and from what it ran. */
function jobRecord(kind: string, extra: Record<string, unknown>, out: string) {
  const root = repoRoot(import.meta.filename);
  const env = process.env;
  const outputs = readdirSync(out)
    .filter((f) => f !== "job.json")
    .toSorted()
    .map((f) => ({ file: f, sha256: sha256(readFileSync(path.join(out, f))) }));
  return {
    schema: JOB_SCHEMA,
    kind,
    commit: git(["rev-parse", "HEAD"], root),
    script: {
      "packages/ichnaea/scripts/stats/sweep-job.ts": sha256(readFileSync(import.meta.filename)),
    },
    runner: {
      imageOS: env["ImageOS"] ?? null,
      imageVersion: env["ImageVersion"] ?? null,
      os: env["RUNNER_OS"] ?? process.platform,
      arch: process.arch,
      cpus: availableParallelism(),
    },
    github: {
      runId: env["GITHUB_RUN_ID"] ?? null,
      runAttempt: env["GITHUB_RUN_ATTEMPT"] ?? null,
      ref: env["GITHUB_REF"] ?? null,
      sha: env["GITHUB_SHA"] ?? null,
    },
    node: process.version,
    ...extra,
    outputs,
  };
}

const writeJob = (out: string, kind: string, extra: Record<string, unknown>): void =>
  writeFileSync(
    path.join(out, "job.json"),
    `${JSON.stringify(jobRecord(kind, extra, out), null, 2)}\n`,
  );

/** Runs a study script with Node; resolves with its standard error, rejects on a failure. */
function run(script: string, args: readonly string[], stdout?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(import.meta.dirname, script), ...args], {
      stdio: ["ignore", stdout === undefined ? "inherit" : "pipe", "pipe"],
    });
    let err = "";
    child.stderr?.on("data", (d: Buffer) => (err += d.toString()));
    child.stdout?.on("data", (d: Buffer) => stdout !== undefined && appendFileSync(stdout, d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(err)
        : reject(new Error(`${script} ${args.join(" ")} exited ${code}:\n${err}`)),
    );
  });
}

function prepare(out: string): void {
  mkdirSync(out, { recursive: true });
  if (readdirSync(out).length > 0) throw new Error(`${out} is not empty`);
}

/** The arguments of the exact phase `p` at margin index i, as the server gave them. */
export const exactArgs = (p: ExactPhase, i: number, tsv: string, skips: string): string[] => [
  ...MARGIN_ARGS,
  String(i),
  String(MARGINS),
  EXACT[p].cases,
  ...EXACT[p].options,
  "--out",
  tsv,
  "--skip-log",
  skips,
];

async function exact(p: ExactPhase, i: number, out: string): Promise<void> {
  const base = path.join(out, exactBase(p, i));
  const args = exactArgs(p, i, `${base}.tsv`, `${base}.skips.jsonl`);
  const err = await run("study-heterogeneous.ts", args);
  // The server held each worker to an empty standard error.
  if (err !== "") throw new Error(`the sweep wrote to standard error:\n${err}`);
  const seedBase = EXACT[p].seedBase;
  writeJob(out, "exact", {
    phase: p,
    margin: marginText(i),
    worker: i,
    workers: MARGINS,
    arguments: args,
    seeds: {
      rule: `${seedBase} + round(margin × 10,000), MT19937`,
      seed: seedBase + Math.round(Number(marginText(i)) * 10_000),
    },
  });
}

async function structures(out: string): Promise<void> {
  const file = path.join(out, "structures.jsonl");
  const args = ["--one-trial", "--out", file];
  await run("generate-structures.ts", args);
  const digest = sha256(readFileSync(file));
  if (digest !== GENERATOR_SHA256)
    throw new Error(`the large suites have sha256 ${digest}, not ${GENERATOR_SHA256}`);
  writeJob(out, "structures", {
    arguments: args,
    seeds: { rule: "7000000 + 1000·(margin index) + (cell index), MT19937" },
    expectedSha256: GENERATOR_SHA256,
  });
}

async function embed(root: string, out: string, margins: readonly number[]): Promise<void> {
  const file = path.join(out, "embedded.jsonl");
  const inputs = margins.map((i) => exactFiles(root, "B", i).tsv);
  const args = [...inputs, "--out", file];
  await run("embed-worst.ts", args);
  writeJob(out, "embedded", { arguments: args, inputs: inputs.map((f) => path.basename(f)) });
}

async function simulate(
  root: string,
  set: SimulationSet,
  job: number,
  jobs: number,
  out: string,
  margins: readonly number[],
): Promise<void> {
  const { seedBase, minK = 1 } = SIMULATIONS[set];
  const inputs = simulationInputs(root, set, margins);
  for (const f of inputs) if (!existsSync(f)) throw new Error(`input ${f} is missing`);
  const workers = PROCESSES * jobs;
  const all = readStructures(inputs);
  const shards = await Promise.all(
    workersOf(job).map(async (worker) => {
      const tsv = path.join(out, simulationBase(set, worker));
      const args = [
        ...inputs,
        "--out",
        tsv,
        "--seed-base",
        String(seedBase),
        "--worker",
        String(worker),
        "--workers",
        String(workers),
        ...(minK > 1 ? ["--min-k", String(minK)] : []),
      ];
      const err = await run("simulate-structures.ts", args, tsv.replace(/\.tsv$/, ".log"));
      if (!err.includes("the shard is complete")) throw new Error(`${tsv}: ${err}`);
      const mine = shardOf(all, { seedBase, worker, workers, minK });
      const first = mine[0]?.index;
      const last = mine.at(-1)?.index;
      return {
        worker,
        arguments: args,
        structures: mine.length,
        seeds:
          first === undefined || last === undefined
            ? null
            : {
                first: seedOf(seedBase, first),
                last: seedOf(seedBase, last),
                confirmOffset: 100_000,
              },
      };
    }),
  );
  writeJob(out, "simulation", {
    set,
    job,
    workers,
    seedBase,
    minK,
    inputs: inputs.map((f) => path.basename(f)),
    seeds: { rule: `${seedBase} + i + 100,000·⌊i / 100,000⌋, confirmations +100,000, MT19937` },
    shards,
  });
}

/** Parses "--margins 0,50" into indices; every margin by default. */
export function marginsOf(text: string | undefined): number[] {
  if (text === undefined) return range(MARGINS);
  const ms = text.split(",").map(Number);
  for (const i of ms)
    if (!Number.isInteger(i) || i < 0 || i >= MARGINS) throw new RangeError(`no margin index ${i}`);
  return [...new Set(ms)].toSorted((a, b) => a - b);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      out: { type: "string" },
      in: { type: "string" },
      phase: { type: "string" },
      margin: { type: "string" },
      set: { type: "string" },
      job: { type: "string" },
      jobs: { type: "string" },
      margins: { type: "string" },
    },
  });
  const margins = marginsOf(values.margins);
  if (command === "plan") {
    const jobs = values.jobs === undefined ? undefined : Number(values.jobs);
    const env = (phase: Phase): boolean =>
      process.env[`SWEEP_${phase.replace("-", "_").toUpperCase()}`] === "true";
    const p = plan(parsePhases(PHASES.filter(env).join(",")), margins, jobs);
    const lines = Object.entries(p).flatMap(([k, v]) =>
      typeof v === "string"
        ? [`${k}=${v}`]
        : [`${k}=${JSON.stringify(v)}`, `${k}_count=${v.include.length}`],
    );
    const output = process.env["GITHUB_OUTPUT"];
    if (output === undefined) console.log(lines.join("\n"));
    else appendFileSync(output, `${lines.join("\n")}\n`);
    for (const [k, v] of Object.entries(p))
      if (typeof v !== "string") console.log(`${k}: ${v.include.length} jobs`);
    return;
  }
  const out = values.out;
  if (out === undefined) throw new Error("give the output directory with --out");
  prepare(out);
  const root = values.in ?? "";
  if (command === "exact") {
    const p = values.phase;
    if (p !== "A" && p !== "B" && p !== "C") throw new Error("--phase must be A, B or C");
    const [i] = marginsOf(values.margin);
    if (values.margin === undefined || i === undefined) throw new Error("give --margin");
    await exact(p, i, out);
  } else if (command === "structures") await structures(out);
  else if (command === "embed") await embed(root, out, margins);
  else if (command === "simulate") {
    const set = values.set;
    if (!isSet(set)) throw new Error(`unknown set ${set}`);
    const jobs = values.jobs === undefined ? SIMULATIONS[set].jobs : Number(values.jobs);
    const job = Number(values.job);
    if (!(Number.isInteger(job) && job >= 0 && job < jobs))
      throw new RangeError("--job must lie in [0, jobs)");
    await simulate(root, set, job, jobs, out, margins);
  } else throw new Error(`unknown command ${command}`);
}

if (import.meta.main) await main();
