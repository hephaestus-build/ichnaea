// The job plan of a sharded statistics study on GitHub Actions (.github/workflows/stats-study.yml):
// which scripts a study runs, and the matrices of its screen and second phase. Each job runs
// PROCESSES shards in parallel, shard index PROCESSES·job + process of PROCESSES·jobs, so a
// shard's rows depend only on its index and count, never on the job that ran it.
//
// Usage:
//   node scripts/stats/study-plan.ts --study <name> --jobs <J> --second-jobs <R> [--pilot i,j]
//                                    [--max-parallel <m>]   (at most 30; 20 by default)
//     appends the plan to $GITHUB_OUTPUT, or prints it without one;
//   node scripts/stats/study-plan.ts prepare --study <name>
//     runs the study's prepare commands, stops at the first that fails, and appends the paths of
//     the files they write to $GITHUB_OUTPUT as `paths`.
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

/** Shards that one job runs in parallel, one process each. */
export const PROCESSES = 4;
/** GitHub runs at most 256 jobs from one matrix. */
export const MAX_MATRIX_JOBS = 256;

/**
 * Jobs of one matrix that run at the same time. The organisation's repositories share one pool of
 * runners, and Ichnaea keeps within 20 of them, its pull request CI included, so that the other
 * repositories' merge queues never wait for it. One heavy workflow runs at a time (the shared
 * concurrency group `heavy-runners`) and one of its matrices at a time, so a matrix takes at most 14
 * runners and 12 by default, which leaves room for the CI of the pull request at the front.
 */
export const DEFAULT_MAX_PARALLEL = 12;
/** The most jobs of one matrix that a study may run at once. */
export const MAX_PARALLEL_CAP = 14;

/** Parses the jobs of one matrix that run at once: a whole number from 1 to MAX_PARALLEL_CAP. */
export function maxParallelOf(text: string | undefined): number {
  if (text === undefined || text.trim() === "") return DEFAULT_MAX_PARALLEL;
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PARALLEL_CAP)
    throw new RangeError(
      `max-parallel must be a whole number from 1 to ${MAX_PARALLEL_CAP}, so that Ichnaea keeps within 20 runners of the shared pool; got '${text}'`,
    );
  return n;
}

/** What a study runs. Every path is relative to packages/ichnaea. */
export interface Study {
  /** The study script: `screen --shard i/n` and `<second> --points <file> --shard i/n`. */
  readonly script: string;
  /** The collector: `select --in <dir>` writes the points file; `verdict --in <dir>` judges. */
  readonly collector: string;
  /** The name of the phase that reruns the selected points, as the study script calls it. */
  readonly second: "recheck" | "confirm";
  /** The file that `select` writes and the second phase reads. */
  readonly points: string;
  /** Commands that run once before any screen shard, each an argument list for node. */
  readonly prepare: readonly (readonly string[])[];
  /** The files the prepare commands write, kept as the dispatch's `<study>-prepare` artifact. */
  readonly prepareArtifacts: readonly string[];
}

/** The studies this workflow runs. */
export const STUDIES: Readonly<Record<string, Study>> = {
  "score-type-i": {
    script: "scripts/stats/study-score-type-i.ts",
    collector: "scripts/stats/collect-score-type-i.ts",
    second: "recheck",
    points: "recheck.json",
    prepare: [],
    prepareArtifacts: [],
  },
  "score-ni": {
    script: "scripts/stats/study-score-ni.ts",
    collector: "scripts/stats/collect-score-ni.ts",
    second: "confirm",
    points: "confirm.json",
    prepare: [
      ["scripts/stats/score-ni-seeds.ts", "validation/score-ni-seeds.json"],
      ["scripts/stats/collect-score-ni.ts", "structures"],
    ],
    prepareArtifacts: ["validation/score-ni-seeds.json"],
  },
};

/** One job of a sharded phase: its index, its shards and their count, and its artifact. */
export interface ShardJob {
  readonly job: number;
  /** The shard indices, comma-separated. */
  readonly shards: string;
  readonly count: number;
  readonly artifact: string;
}

/** The plan of one dispatch. */
export interface StudyPlan {
  readonly study: string;
  readonly script: string;
  readonly collector: string;
  readonly second: string;
  readonly points: string;
  /** The prepare commands and the files they write, as JSON `{ commands, artifacts }`. */
  readonly prepare: string;
  /** Whether the study has prepare commands. */
  readonly prepared: boolean;
  /** Whether only the pilot's screen shards run, with no selection, second phase or verdict. */
  readonly pilot: boolean;
  /** Jobs of one matrix that run at the same time. */
  readonly maxParallel: number;
  readonly screen: { readonly include: readonly ShardJob[] };
  /** The second phase's shard count and jobs. Its shards come from the points file. */
  readonly secondCount: number;
  readonly secondJobs: { readonly include: readonly ShardJob[] };
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** Parses a positive whole number of jobs no larger than the matrix limit. */
export function jobsOf(text: string, what: string): number {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > MAX_MATRIX_JOBS)
    throw new RangeError(
      `${what} must be a whole number from 1 to ${MAX_MATRIX_JOBS}, got '${text}'`,
    );
  return n;
}

/** The jobs of a phase with `jobs` jobs: job j runs shards PROCESSES·j to PROCESSES·j + 3. */
function sharded(study: string, phase: string, jobs: number): ShardJob[] {
  const count = PROCESSES * jobs;
  return range(jobs).map((job) => ({
    job,
    shards: range(PROCESSES)
      .map((p) => PROCESSES * job + p)
      .join(","),
    count,
    artifact: `${study}-${phase}-${job}`,
  }));
}

/**
 * The plan of a dispatch. A pilot runs each listed screen shard as its own job, at the shard count
 * of the full screen, so a pilot shard's rows and time are the ones the full run would have.
 */
export function plan(input: {
  readonly study: string;
  readonly jobs: number;
  readonly secondJobs: number;
  readonly pilot: readonly number[];
  readonly maxParallel?: number;
}): StudyPlan {
  const study = STUDIES[input.study];
  if (study === undefined)
    throw new Error(
      `unknown study '${input.study}'; the studies are ${Object.keys(STUDIES).join(", ")}`,
    );
  const count = PROCESSES * input.jobs;
  for (const i of input.pilot)
    if (!Number.isInteger(i) || i < 0 || i >= count)
      throw new RangeError(`pilot shard ${i} is not one of the ${count} screen shards`);
  const pilot = [...new Set(input.pilot)].toSorted((a, b) => a - b);
  const screen =
    pilot.length > 0
      ? pilot.map((i, job) => ({
          job,
          shards: String(i),
          count,
          artifact: `${input.study}-screen-${job}`,
        }))
      : sharded(input.study, "screen", input.jobs);
  return {
    study: input.study,
    script: study.script,
    collector: study.collector,
    second: study.second,
    points: study.points,
    prepare: JSON.stringify({ commands: study.prepare, artifacts: study.prepareArtifacts }),
    prepared: study.prepare.length > 0,
    pilot: pilot.length > 0,
    maxParallel: input.maxParallel ?? DEFAULT_MAX_PARALLEL,
    screen: { include: screen },
    secondCount: PROCESSES * input.secondJobs,
    secondJobs: {
      include: pilot.length > 0 ? [] : sharded(input.study, study.second, input.secondJobs),
    },
  };
}

/** Parses "0,57" into shard indices; empty or absent means no pilot. */
export function pilotOf(text: string | undefined): number[] {
  if (text === undefined || text.trim() === "") return [];
  return text.split(",").map((s) => {
    const t = s.trim();
    if (!/^\d+$/.test(t)) throw new RangeError(`pilot shard '${t}' is not a whole number`);
    return Number(t);
  });
}

/** Appends lines to $GITHUB_OUTPUT, or prints them without one. */
function output(lines: readonly string[]): void {
  const file = process.env["GITHUB_OUTPUT"];
  if (file === undefined) console.log(lines.join("\n"));
  else appendFileSync(file, `${lines.join("\n")}\n`);
}

/** Runs a study's prepare commands from packages/ichnaea, and returns the files they write. */
export function prepare(name: string, root: string): string[] {
  const study = STUDIES[name];
  if (study === undefined) throw new Error(`unknown study '${name}'`);
  for (const argv of study.prepare) {
    console.log(`node ${argv.join(" ")}`);
    const r = spawnSync(process.execPath, argv, { cwd: root, stdio: "inherit" });
    if (r.status !== 0) throw new Error(`node ${argv.join(" ")} exited ${r.status ?? r.signal}`);
  }
  return study.prepareArtifacts.map((p) => join(root, p));
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      study: { type: "string" },
      jobs: { type: "string" },
      "second-jobs": { type: "string" },
      pilot: { type: "string" },
      "max-parallel": { type: "string" },
    },
  });
  if (positionals[0] === "prepare") {
    const paths = prepare(values.study ?? "", join(import.meta.dirname, "..", ".."));
    output([`paths<<PATHS`, ...paths, "PATHS"]);
  } else {
    const p = plan({
      study: values.study ?? "",
      jobs: jobsOf(values.jobs ?? "", "jobs"),
      secondJobs: jobsOf(values["second-jobs"] ?? "", "second-jobs"),
      pilot: pilotOf(values.pilot),
      maxParallel: maxParallelOf(values["max-parallel"]),
    });
    output([
      ...Object.entries(p).map(([k, v]) =>
        typeof v === "object" ? `${k}=${JSON.stringify(v)}` : `${k}=${String(v)}`,
      ),
      `screen_count=${p.screen.include.length}`,
      `second_count=${p.secondJobs.include.length}`,
    ]);
    console.log(
      `${p.study}: ${p.screen.include.length} screen job(s)${p.pilot ? " (pilot)" : ""}, ${p.secondJobs.include.length} ${p.second} job(s)`,
    );
  }
}
