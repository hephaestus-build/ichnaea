// What one test run under a mutant shows, for the mutant runners of every area
// (scripts/{stats,contracts,decide}/mutants.ts). Only an assertion failure is a kill. A crash, a
// suite that cannot load, a timeout, a test that fails without an assertion or a run with no report
// is an error, and an error fails the whole mutation run: it proves nothing about the tests.
//
// Every runner also applies two controls before its mutants: a comment-only canary, which no test
// can detect and which must survive, and a deliberate behaviour break, which must be killed. Together
// they show that the runner tells a kill from a survivor on this run.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The parts of vitest's JSON report that decide the outcome. */
export interface VitestReport {
  readonly success: boolean;
  readonly numFailedTests: number;
  readonly testResults: readonly {
    readonly name: string;
    readonly status: string;
    readonly message?: string;
    readonly assertionResults: readonly {
      readonly fullName?: string;
      readonly title: string;
      readonly status: string;
      readonly failureMessages: readonly string[];
    }[];
  }[];
}

/** One test run under a mutant. */
export type Outcome =
  | { readonly kind: "survived" }
  | { readonly kind: "killed"; readonly by: readonly string[] }
  | { readonly kind: "error"; readonly reason: string };

const ASSERTION = /AssertionError/;
const TIMEOUT = /Test timed out|Hook timed out/;

/** The outcome of a run from its exit code and its report (undefined when there is none). */
export function classify(exitCode: number | null, report: VitestReport | undefined): Outcome {
  if (report === undefined) return { kind: "error", reason: `no test report (exit ${exitCode})` };
  if (exitCode === 0 && report.success) return { kind: "survived" };
  if (exitCode === 0 || report.success)
    return { kind: "error", reason: `exit ${exitCode} disagrees with the report` };
  for (const suite of report.testResults)
    if (suite.status === "failed" && suite.message !== undefined && suite.message !== "")
      return { kind: "error", reason: `${suite.name} did not run: ${suite.message.slice(0, 300)}` };
  const failed = report.testResults.flatMap((s) =>
    s.assertionResults
      .filter((a) => a.status === "failed")
      .map((a) => ({ name: `${s.name}: ${a.fullName ?? a.title}`, messages: a.failureMessages })),
  );
  if (failed.length === 0)
    return { kind: "error", reason: "the run failed, but no test failed (an unhandled error?)" };
  const timedOut = failed.find((f) => f.messages.some((m) => TIMEOUT.test(m)));
  if (timedOut !== undefined) return { kind: "error", reason: `timed out: ${timedOut.name}` };
  const by = failed.filter((f) => f.messages.some((m) => ASSERTION.test(m))).map((f) => f.name);
  if (by.length === 0)
    return {
      kind: "error",
      reason: `tests failed without an assertion: ${failed[0]!.name}: ${failed[0]!.messages[0]?.slice(0, 300)}`,
    };
  return { kind: "killed", by };
}

/** The directory that keeps each run's output, so that an error can be read afterwards. */
let logs: string | undefined;
const logDir = (): string => (logs ??= mkdtempSync(join(tmpdir(), "mutants-")));

/** Runs vitest on `projects` in `cwd` and judges the run. The output is kept under a log name. */
export function runTests(cwd: string, projects: readonly string[], name: string): Outcome {
  const dir = logDir();
  const safe = name.replace(/[^\w.-]+/g, "_").slice(0, 80);
  const reportFile = join(dir, `${safe}.json`);
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      ...projects.flatMap((p) => ["--project", p]),
      "--reporter=json",
      `--outputFile=${reportFile}`,
    ],
    { cwd, encoding: "utf8", timeout: 30 * 60_000, maxBuffer: 256 * 1024 * 1024 },
  );
  writeFileSync(join(dir, `${safe}.log`), `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  if (result.error !== undefined)
    return { kind: "error", reason: `${result.error.message} (log: ${join(dir, `${safe}.log`)})` };
  let report: VitestReport | undefined;
  try {
    report = JSON.parse(readFileSync(reportFile, "utf8")) as VitestReport;
  } catch {
    report = undefined;
  }
  const outcome = classify(result.status, report);
  return outcome.kind === "error"
    ? { kind: "error", reason: `${outcome.reason} (log: ${join(dir, `${safe}.log`)})` }
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
