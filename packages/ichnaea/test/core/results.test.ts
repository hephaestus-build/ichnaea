import { describe, expect, it } from "vitest";

import {
  type CompletedRow,
  ImportError,
  importResults,
  NOT_CAPTURED,
  type ResultRow,
} from "../../src/core/index.ts";
import { createPlan } from "../../src/decide/index.ts";
import { configuration, SUITE } from "./support/library.ts";

const base = configuration("base prompt", 0.2);
const candidate = configuration("candidate prompt", 0.2);
const plan = createPlan(SUITE, {
  run: "run-1",
  base,
  candidate,
  intendedChanges: ["/prompts/composer"],
  createdAt: "2026-11-16T12:00:00Z",
});
const identity = (arm: string): string =>
  plan.record.arms.find((a) => a.name === arm)?.identity ?? "";

/** One completed row for every planned trial, each answering and declining. */
const rows = (): ResultRow[] =>
  plan.record.trials.map((t) => ({
    case: t.case,
    arm: t.arm,
    replicate: t.replicate,
    outcome: "completed",
    configuration: identity(t.arm),
    output: { text: "answer", declined: true },
    startedAt: "2026-11-16T12:01:00Z",
    endedAt: "2026-11-16T12:02:00Z",
    calls: 1,
  }));

const replace = (all: ResultRow[], index: number, row: ResultRow): ResultRow[] =>
  all.map((r, i) => (i === index ? row : r));

describe("importResults", () => {
  it("scores each completed row from its raw output, with every measure the plan uses", () => {
    const { records, summary } = importResults(plan, rows());
    expect(records.plan).toBe(plan.record);
    expect(records.trials).toHaveLength(24);
    expect(records.trials[0]).toMatchObject({
      id: "c1/base/r0",
      run: "run-1",
      outcome: "completed",
      usage: { calls: 1 },
    });
    // answered: 24 values; declines: 12 applicable and 12 not applicable.
    const answered = records.values.filter((v) => v.measure === "composer/answered");
    const declines = records.values.filter((v) => v.measure === "composer/declines");
    expect(answered.every((v) => v.applicable && v.value?.type === "binary" && v.value.pass)).toBe(
      true,
    );
    expect(declines.filter((v) => v.applicable)).toHaveLength(12);
    expect(records.run.ledger.every((e) => e.state === "recorded")).toBe(true);
    expect(records.run.startedAt).toBe("2026-11-16T12:01:00Z");
    expect(records.run.completedAt).toBe("2026-11-16T12:02:00Z");
    expect(summary).toEqual({
      rows: 24,
      trials: 24,
      values: 48,
      outcomes: { completed: 24 },
      notRun: 0,
      warnings: [],
      unused: [],
    });
  });

  it("accepts a configuration record in place of its identity", () => {
    const all = rows().map((r) =>
      r.outcome === "completed" ? { ...r, configuration: r.arm === "base" ? base : candidate } : r,
    );
    expect(importResults(plan, all).records.trials.every((t) => t.outcome === "completed")).toBe(
      true,
    );
  });

  it("makes a completed row without captured output a capture failure, and warns", () => {
    const { output: _, ...lost } = rows()[0] as CompletedRow;
    const { records, summary } = importResults(plan, replace(rows(), 0, lost));
    expect(records.trials[0]).toMatchObject({
      outcome: "infrastructure_failure",
      error: { kind: NOT_CAPTURED },
    });
    expect(records.values.filter((v) => v.trial === "c1/base/r0" && v.applicable)).toEqual([]);
    expect(summary.warnings).toEqual([
      "1 completed row(s) had no captured output, for example 'c1/base/r0'; they count as missing trials, never as failures of the system",
    ]);
  });

  it("never gives a failed trial a passing value, whatever its output", () => {
    const failed: ResultRow = {
      case: "c1",
      arm: "base",
      replicate: 0,
      outcome: "system_failure",
      reason: "the composer crashed",
      output: { text: "answer", declined: true },
    } as ResultRow;
    const { records } = importResults(plan, replace(rows(), 0, failed));
    expect(records.trials[0]).toMatchObject({
      outcome: "system_failure",
      error: { kind: "system_failure", message: "the composer crashed" },
    });
    const value = records.values.find(
      (v) => v.trial === "c1/base/r0" && v.measure === "composer/answered",
    );
    expect(value?.value).toEqual({ type: "binary", pass: false });
  });

  it("marks a row that ran another configuration as an invalid configuration, with no value", () => {
    const other = { ...rows()[0]!, configuration: identity("candidate") } as ResultRow;
    const { records, summary } = importResults(plan, replace(rows(), 0, other));
    expect(records.trials[0]?.outcome).toBe("invalid_configuration");
    expect(records.values.some((v) => v.trial === "c1/base/r0")).toBe(false);
    expect(summary.warnings[0]).toMatch(/1 row\(s\) ran another configuration than their arm/);
  });

  it("records a planned trial without a row as not run", () => {
    const { records, summary } = importResults(plan, rows().slice(1));
    expect(records.run.ledger[0]).toEqual({
      trial: "c1/base/r0",
      state: "planned",
      outcome: "not_run",
    });
    expect(summary.notRun).toBe(1);
  });

  it("reports unknown extra keys as unused, and refuses a row the plan does not list", () => {
    const extra = { ...rows()[0]!, latencyMs: 12, model: "x" };
    expect(importResults(plan, replace(rows(), 0, extra as ResultRow)).summary.unused).toEqual([
      "latencyMs",
      "model",
    ]);
    const stray = { ...rows()[0]!, case: "nope" } as ResultRow;
    expect(() => importResults(plan, replace(rows(), 0, stray))).toThrow(
      "row 1: trial 'nope/base/r0' is not in the plan",
    );
  });

  it("refuses a row that is missing a required key, or repeats a trial", () => {
    const { arm: _, ...armless } = rows()[0]!;
    expect(() => importResults(plan, replace(rows(), 0, armless as ResultRow))).toThrow(
      /row 1 is not a valid result row:[^]*arm/,
    );
    const twice = [...rows(), rows()[0]!];
    expect(() => importResults(plan, twice)).toThrow(/duplicate trial ID\(s\): c1\/base\/r0/);
  });

  it("records the runtime it is given, and says so when it is not", () => {
    const runtime = { name: "node", version: "24.3.0", platform: "darwin", arch: "arm64" };
    expect(importResults(plan, rows(), { runtime }).records.run.environment).toEqual({
      node: "24.3.0",
      platform: "darwin-arm64",
      ichnaea: plan.record.ichnaea,
      arch: "arm64",
      runtime,
    });
    expect(importResults(plan, rows()).records.run.environment).toMatchObject({
      node: "unknown",
      platform: "unknown-unknown",
    });
  });
});

describe("the error", () => {
  it("is an ImportError", () => {
    expect(() => importResults(plan, [{} as ResultRow])).toThrow(ImportError);
  });
});
