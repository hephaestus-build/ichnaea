// What one test run under a mutant shows, for the mutant runners of every area
// (scripts/{stats,contracts,decide}/mutants.ts). Only an assertion failure is a kill, judged by the
// error's class from a reporter that records it (scripts/mutation-reporter.ts): AssertionError or
// JestAssertionError, or a fast-check property that returned false or whose predicate failed an
// assertion. A crash, a suite that cannot load, a timeout, a test that fails by any other error or
// a run with no report is an error, and an error fails the whole mutation run.
//
// Every runner also applies two controls before its mutants: a comment-only canary, which no test
// can detect and which must survive, and a deliberate behaviour break, which must be killed. Together
// they show that the runner tells a kill from a survivor on this run.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MutationError, MutationReport } from "./mutation-reporter.ts";

/** One test run under a mutant. */
export type Outcome =
  | { readonly kind: "survived" }
  | { readonly kind: "killed"; readonly by: readonly string[] }
  | { readonly kind: "error"; readonly reason: string };

/** The error classes of an assertion: chai's, and vitest's jest-compatible one. */
const ASSERTION_CLASSES = new Set(["AssertionError", "JestAssertionError"]);
const PROPERTY_FAILED = "Property failed after";
const RETURNED_FALSE = "Property failed by returning false";
const TIMEOUT = /^(Test|Hook) timed out/;

/**
 * Whether an error is an assertion failure, by its class. A fast-check property failure is one
 * when its predicate returned false, or when the error its predicate threw (its cause) is an
 * assertion; a property whose predicate threw any other error is not.
 */
export function isAssertion(error: MutationError): boolean {
  if (ASSERTION_CLASSES.has(error.name)) return true;
  if (error.message.startsWith(PROPERTY_FAILED)) {
    if (error.cause === undefined) return false;
    return error.cause.message.startsWith(RETURNED_FALSE) || isAssertion(error.cause);
  }
  return false;
}

/** The outcome of a run from its exit code and its report (undefined when there is none). */
export function classify(exitCode: number | null, report: MutationReport | undefined): Outcome {
  if (report === undefined) return { kind: "error", reason: `no test report (exit ${exitCode})` };
  if (exitCode === 0 && report.passed && report.failed.length === 0) return { kind: "survived" };
  if (exitCode === 0 || report.passed)
    return { kind: "error", reason: `exit ${exitCode} disagrees with the report` };
  const loading = report.modules[0];
  if (loading !== undefined)
    return {
      kind: "error",
      reason: `${loading.module} did not run: ${loading.errors[0]?.name}: ${loading.errors[0]?.message.slice(0, 300)}`,
    };
  // A type error from the typecheck pass is not a crash of the tests: it counts only when no
  // assertion failed, and then as an error, because the mutant does not type-check.
  const typeErrors = report.unhandled.filter((e) => e.name === "TypeCheckError");
  const unhandled = report.unhandled.find((e) => e.name !== "TypeCheckError");
  if (unhandled !== undefined)
    return {
      kind: "error",
      reason: `unhandled ${unhandled.name}: ${unhandled.message.slice(0, 300)}`,
    };
  if (report.failed.length === 0)
    return {
      kind: "error",
      reason:
        typeErrors[0] === undefined
          ? "the run failed, but no test failed"
          : `the mutant does not type-check: ${typeErrors[0].message.slice(0, 300)}`,
    };
  const timedOut = report.failed.find((f) => f.errors.some((e) => TIMEOUT.test(e.message)));
  if (timedOut !== undefined) return { kind: "error", reason: `timed out: ${timedOut.test}` };
  const by = report.failed.filter((f) => f.errors.some(isAssertion)).map((f) => f.test);
  if (by.length === 0) {
    const first = report.failed[0]!;
    const e = first.errors[0];
    return {
      kind: "error",
      reason: `tests failed without an assertion: ${first.test}: ${e?.name}: ${e?.message.slice(0, 300)}`,
    };
  }
  return { kind: "killed", by };
}

/** The directory that keeps each run's output, so that an error can be read afterwards. */
let logs: string | undefined;
const logDir = (): string => (logs ??= mkdtempSync(join(tmpdir(), "mutants-")));
const REPORTER = join(import.meta.dirname, "mutation-reporter.ts");

/** Runs vitest on `projects` in `cwd` and judges the run. The output is kept under a log name. */
export function runTests(cwd: string, projects: readonly string[], name: string): Outcome {
  const dir = logDir();
  const safe = name.replace(/[^\w.-]+/g, "_").slice(0, 80);
  const reportFile = join(dir, `${safe}.json`);
  const logFile = join(dir, `${safe}.log`);
  const result = spawnSync(
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
