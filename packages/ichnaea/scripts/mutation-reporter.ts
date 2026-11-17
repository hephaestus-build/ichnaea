// A vitest reporter for the mutant runners (scripts/mutation.ts). It writes, to the file named by
// ICHNAEA_MUTATION_REPORT, the structure of every error of a run: each failed test's errors with
// their name, whether they carry an expected and actual value, their cause and their leading stack
// frames; each test module that did not run; and the unhandled errors. The classifier decides from
// this structure what the run shows.
import { writeFileSync } from "node:fs";

import type { Reporter, SerializedError, TestModule } from "vitest/node";

/** One error, as the classifier reads it. */
export interface MutationError {
  readonly name: string;
  readonly message: string;
  /** True when the error carries `actual` or `expected`, as an assertion error does. */
  readonly comparison: boolean;
  /** The leading frames of its stack, at most 20, without the "at " prefix's indentation. */
  readonly frames: readonly string[];
  readonly cause?: MutationError;
}

/** What one run wrote. */
export interface MutationReport {
  readonly passed: boolean;
  /** Test modules that did not run: an import or a syntax error, for example. */
  readonly modules: readonly {
    readonly module: string;
    readonly errors: readonly MutationError[];
  }[];
  readonly failed: readonly { readonly test: string; readonly errors: readonly MutationError[] }[];
  readonly unhandled: readonly MutationError[];
}

type ErrorLike = Partial<SerializedError> & {
  cause?: unknown;
  actual?: unknown;
  expected?: unknown;
};

function describe(error: unknown, depth = 0): MutationError {
  const e = (
    typeof error === "object" && error !== null ? error : { message: String(error) }
  ) as ErrorLike;
  const frames = (e.stack ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "))
    .slice(0, 20);
  return {
    // vitest names a serialised cause "Caused by: <class>"; the class is what counts.
    name: typeof e.name === "string" ? e.name.replace(/^Caused by: /, "") : "",
    message: typeof e.message === "string" ? e.message : "",
    comparison: "actual" in e || "expected" in e,
    frames,
    ...(e.cause !== undefined && depth < 5 ? { cause: describe(e.cause, depth + 1) } : {}),
  };
}

export default class MutationReporter implements Reporter {
  onTestRunEnd(modules: readonly TestModule[], unhandledErrors: readonly SerializedError[]): void {
    const file = process.env["ICHNAEA_MUTATION_REPORT"];
    if (file === undefined) return;
    const report: MutationReport = {
      passed: modules.every((m) => m.ok()) && unhandledErrors.length === 0,
      modules: modules
        .filter((m) => m.errors().length > 0)
        .map((m) => ({ module: m.moduleId, errors: m.errors().map((e) => describe(e)) })),
      failed: modules.flatMap((m) =>
        [...m.children.allTests()]
          .filter((t) => t.result().state === "failed")
          .map((t) => ({
            test: `${m.moduleId}: ${t.fullName}`,
            errors: (t.result().errors ?? []).map((e) => describe(e)),
          })),
      ),
      unhandled: unhandledErrors.map((e) => describe(e)),
    };
    writeFileSync(file, `${JSON.stringify(report, null, 1)}\n`);
  }
}
