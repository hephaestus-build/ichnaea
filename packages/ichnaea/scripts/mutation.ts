// What one test run under a mutant shows, for the mutant runners of every area
// (scripts/{stats,contracts,decide}/mutants.ts). Only an assertion failure is a kill, judged by the
// error's class from a reporter that records it (scripts/mutation-reporter.ts): AssertionError or
// JestAssertionError, or a fast-check property that returned false or whose predicate failed an
// assertion. A crash, a suite that cannot load, a test that fails by any other error or a run with
// no report is an error, and an error fails the whole mutation run. A test that times out under a
// mutant detects it, as Stryker counts it; the run fails only when more than a tenth of its mutants
// are detected by a timeout alone.
//
// Every runner also applies two controls before its mutants: a comment-only canary, which no test
// can detect and which must survive, and a deliberate behaviour break, which must be killed. Together
// they show that the runner tells a kill from a survivor on this run.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MutationError, MutationReport } from "./mutation-reporter.ts";

/** One test run under a mutant. */
export type Outcome =
  | { readonly kind: "survived" }
  | {
      readonly kind: "killed";
      readonly by: readonly string[];
      /** Failures under the same mutant that were not assertions, kept visible in the report. */
      readonly alsoCrashed?: readonly string[];
    }
  /** Detected by a test that timed out under the mutant, as Stryker counts it. */
  | { readonly kind: "timedOut"; readonly test: string }
  | { readonly kind: "error"; readonly reason: string };

/** The error classes of an assertion: chai's, and vitest's jest-compatible one. */
const ASSERTION_CLASSES = new Set(["AssertionError", "JestAssertionError"]);
const PROPERTY_FAILED = "Property failed after";
const RETURNED_FALSE = "Property failed by returning false";
const TIMEOUT = /^(Test|Hook) timed out/;
const timesOut = (e: MutationError): boolean => TIMEOUT.test(e.message);

/** A stack frame in a test file: `x.test.ts:12:3`, or a `.test-d.ts`, `.test.mts`, … file. */
const TEST_FRAME = /\.test(-d)?\.[cm]?[jt]sx?:\d+/;

/**
 * Whether an assertion error was raised by a test: its first frame that names a file outside
 * `node_modules` (that is, past the assertion library's own frames) lies in a test file. An AssertionError that a runtime
 * dependency raises has the source that called it there, so it is not a kill.
 */
export function raisedByTest(error: MutationError): boolean {
  // Frames with no file (`<anonymous>`, `node:` internals, `index 0`) say nothing about who raised it.
  const first = error.frames.find(
    (f) => /[/\\]/.test(f) && !/[/\\]node_modules[/\\]/.test(f) && !f.includes("(node:"),
  );
  return first !== undefined && TEST_FRAME.test(first);
}

/**
 * Whether an error is an assertion failure, by its class. A fast-check property failure is one
 * when its predicate returned false, or when the error its predicate threw (its cause) is an
 * assertion; a property whose predicate threw any other error is not.
 */
export function isAssertion(error: MutationError): boolean {
  if (ASSERTION_CLASSES.has(error.name)) return raisedByTest(error);
  if (error.message.startsWith(PROPERTY_FAILED)) {
    if (error.cause === undefined) return false;
    return error.cause.message.startsWith(RETURNED_FALSE) || isAssertion(error.cause);
  }
  return false;
}

/** An error in one line, for a list of crashes. */
const short = (e: MutationError): string => `${e.name}: ${e.message.split("\n")[0]?.slice(0, 200)}`;

/** The outcome of a run from its exit code and its report (undefined when there is none). */
export function classify(exitCode: number | null, report: MutationReport | undefined): Outcome {
  if (report === undefined) return { kind: "error", reason: `no test report (exit ${exitCode})` };
  const suites = report.suites;
  if (exitCode === 0 && report.passed && report.failed.length === 0 && suites.length === 0)
    return { kind: "survived" };
  if (exitCode === 0 || report.passed)
    return { kind: "error", reason: `exit ${exitCode} disagrees with the report` };
  // A file-level hook (beforeAll, afterAll) that timed out lands on the module; it is a detection
  // by timeout. Any other module error, a collection failure for one, means the module did not run.
  const loading = report.modules.find((m) => !m.errors.every(timesOut));
  if (loading !== undefined)
    return {
      kind: "error",
      reason: `${loading.module} did not run: ${loading.errors[0]?.name}: ${loading.errors[0]?.message.slice(0, 300)}`,
    };
  // Every failure that is not an assertion: a test that threw something else, a suite's hook, an
  // unhandled error. A type error from the typecheck pass is not a crash of the tests.
  const failures = [
    ...report.failed.flatMap((f) =>
      f.errors.filter((e) => !isAssertion(e)).map((e) => ({ at: `${f.test}: `, error: e })),
    ),
    ...suites.flatMap((s) => s.errors.map((e) => ({ at: `${s.suite}: `, error: e }))),
    ...report.unhandled
      .filter((e) => e.name !== "TypeCheckError")
      .map((e) => ({ at: "unhandled ", error: e })),
  ];
  const crashes = failures.map(({ at, error }) => `${at}${short(error)}`);
  // An assertion detected the mutant: that is a kill, whatever else crashed, as Stryker counts it.
  const by = report.failed.filter((f) => f.errors.some(isAssertion)).map((f) => f.test);
  if (by.length > 0)
    return crashes.length === 0
      ? { kind: "killed", by }
      : { kind: "killed", by, alsoCrashed: crashes };
  // With no assertion, any crash that is not a timeout makes the run an error, even beside a
  // timeout: a timeout detects the mutant only when timeouts are the only failures.
  const crash = failures.find(({ error }) => !timesOut(error));
  if (crash !== undefined)
    return {
      kind: "error",
      reason: `no assertion failed; it crashed: ${crash.at}${short(crash.error)}`,
    };
  const timedOut =
    report.failed.find((f) => f.errors.some(timesOut))?.test ??
    suites.find((s) => s.errors.some(timesOut))?.suite ??
    report.modules.find((m) => m.errors.some(timesOut))?.module;
  if (timedOut !== undefined) return { kind: "timedOut", test: timedOut };
  const typeError = report.unhandled.find((e) => e.name === "TypeCheckError");
  return {
    kind: "error",
    reason:
      typeError === undefined
        ? "the run failed, but no test failed"
        : `the mutant does not type-check: ${typeError.message.slice(0, 300)}`,
  };
}

/** The directory that keeps each run's output, so that an error can be read afterwards. */
let logs: string | undefined;
const logDir = (): string => (logs ??= mkdtempSync(join(tmpdir(), "mutants-")));
const REPORTER = join(import.meta.dirname, "mutation-reporter.ts");

/** What a run of vitest returns: `spawnSync`'s result, as far as the judge reads it. */
type Spawn = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    encoding: "utf8";
    timeout: number;
    maxBuffer: number;
    env: NodeJS.ProcessEnv;
  },
) => {
  readonly status: number | null;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly error?: Error;
};

/** The file name under which a run's report and log are kept. */
export const logName = (name: string): string => name.replace(/[^\w.-]+/g, "_").slice(0, 80);

/**
 * Runs vitest on `projects` in `cwd` and judges the run. The output is kept under a log name. The
 * report file is deleted before the run, so a run that writes none can never read a stale one,
 * even when two mutant IDs share a log name.
 */
export function runTests(
  cwd: string,
  projects: readonly string[],
  name: string,
  spawn: Spawn = spawnSync,
  dir: string = logDir(),
): Outcome {
  const safe = logName(name);
  const reportFile = join(dir, `${safe}.json`);
  const logFile = join(dir, `${safe}.log`);
  rmSync(reportFile, { force: true });
  const result = spawn(
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      ...projects.flatMap((p) => ["--project", p]),
      "--reporter=default",
      `--reporter=${REPORTER}`,
    ],
    {
      cwd,
      encoding: "utf8",
      timeout: 30 * 60_000,
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, ICHNAEA_MUTATION_REPORT: reportFile },
    },
  );
  writeFileSync(logFile, `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  if (result.error !== undefined)
    return { kind: "error", reason: `${result.error.message} (log: ${logFile})` };
  let report: MutationReport | undefined;
  try {
    report = JSON.parse(readFileSync(reportFile, "utf8")) as MutationReport;
  } catch {
    report = undefined;
  }
  const outcome = classify(result.status, report);
  return outcome.kind === "error"
    ? { kind: "error", reason: `${outcome.reason} (log: ${logFile})` }
    : outcome;
}

/** How a control mutant must come out, and the message when it does not. */
export const CONTROLS = {
  canary: {
    must: "survived",
    otherwise:
      "the canary was not reported surviving: this run cannot show a survivor, so no kill counts",
  },
  control: {
    must: "killed",
    otherwise:
      "the deliberate break was not killed: this run cannot show a kill, so no result counts",
  },
} as const;

const describe = (o: Outcome): string =>
  o.kind === "error"
    ? `ERROR: ${o.reason}`
    : o.kind === "killed"
      ? o.alsoCrashed === undefined
        ? "killed"
        : `killed (also crashed: ${o.alsoCrashed.join("; ")})`
      : o.kind === "timedOut"
        ? `detected (timeout): ${o.test}`
        : "SURVIVED";

/** The share of a run's mutants that may be detected by a timeout before the run fails. */
export const TIMEOUT_SHARE = 0.1;

/** What a mutation run found. */
export interface MutationResult {
  /** 0 only when the controls held, at least one mutant ran, and every mutant was killed. */
  readonly code: number;
  readonly killed: number;
  /** Mutants detected by a timeout: listed, and failing the run only above TIMEOUT_SHARE. */
  readonly timedOut: readonly string[];
  readonly survivors: readonly string[];
  readonly errors: readonly string[];
}

/** The result of a run that proves nothing: its controls failed, or no mutant ran. */
const FAILED: MutationResult = { code: 1, killed: 0, timedOut: [], survivors: [], errors: [] };

/**
 * Runs the canary, then the control, then each mutant, through `attempt`, which applies one mutant,
 * runs the tests, restores the source and returns the outcome. A canary that does not survive, or a
 * control that is not killed, stops the run. A run with no mutant selected proves nothing and fails.
 * An error gives no result and fails the run.
 */
export function runMutations<M extends { readonly id: string }>(input: {
  readonly canary: M;
  readonly control: M;
  readonly mutants: readonly M[];
  readonly attempt: (mutant: M) => Outcome;
  readonly log?: (line: string) => void;
}): MutationResult {
  const log = input.log ?? console.log;
  if (input.mutants.length === 0) {
    log("no mutants ran: the selection matched none, and an empty run proves nothing");
    return FAILED;
  }
  for (const [mutant, role] of [
    [input.canary, CONTROLS.canary],
    [input.control, CONTROLS.control],
  ] as const) {
    const outcome = input.attempt(mutant);
    if (outcome.kind !== role.must) {
      log(`${mutant.id}: ${describe(outcome)}`);
      log(role.otherwise);
      return FAILED;
    }
    log(`${mutant.id}: ${outcome.kind}, as it must be`);
  }
  let killed = 0;
  const timedOut: string[] = [];
  const survivors: string[] = [];
  const errors: string[] = [];
  for (const mutant of input.mutants) {
    const outcome = input.attempt(mutant);
    log(`${mutant.id}: ${describe(outcome)}`);
    if (outcome.kind === "killed") killed++;
    else if (outcome.kind === "timedOut") timedOut.push(mutant.id);
    else (outcome.kind === "survived" ? survivors : errors).push(mutant.id);
  }
  const total = input.mutants.length;
  log(`${killed} of ${total} mutants killed, ${timedOut.length} detected by a timeout`);
  if (timedOut.length > 0) log(`detected (timeout): ${timedOut.join(", ")}`);
  const tooManyTimeouts = timedOut.length > TIMEOUT_SHARE * total;
  if (tooManyTimeouts)
    log(`more than ${100 * TIMEOUT_SHARE}% of the mutants were detected only by a timeout`);
  if (errors.length > 0) log(`errors (no result): ${errors.join(", ")}`);
  if (survivors.length > 0) log(`survivors: ${survivors.join(", ")}`);
  const code = errors.length === 0 && survivors.length === 0 && !tooManyTimeouts ? 0 : 1;
  if (code === 0) log("every mutant detected");
  return { code, killed, timedOut, survivors, errors };
}
