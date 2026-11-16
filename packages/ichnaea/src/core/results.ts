import * as z from "zod";

import {
  Case,
  caseDigest,
  Configuration,
  configurationIdentity,
  digest,
  Json,
  type MeasureValue,
  type Outcome,
  Run,
  type Runtime,
  Text,
  Timestamp,
  Trial,
} from "../contracts/index.ts";

import { checkCaptured, checkConfiguration, ImportError, NOT_CAPTURED } from "./import-rules.ts";
import { scoreTrials } from "./measures.ts";
import { recordProblems, type RunRecords } from "./records.ts";
import { type SuitePlan, suiteMeasures } from "./suite.ts";

/** The keys every result row has: which planned trial it is, and when and how it ran. */
export interface ResultRowBase {
  /** The case ID. */
  readonly case: string;
  /** The arm's name: `base` or `candidate`. */
  readonly arm: string;
  /** The trial's replicate, from 0. */
  readonly replicate: number;
  /** Where the row came from, for example the worker or the file that produced it. */
  readonly sourceId?: string;
  /** When the trial started, ISO 8601. One trial per case needs it to check each pair's order. */
  readonly startedAt?: string;
  /** When the trial ended, ISO 8601. */
  readonly endedAt?: string;
  /** The calls the trial made, if known. Absent means unknown, never zero. */
  readonly calls?: number;
}

/**
 * A trial that ran and returned: `completed`, or `abstained` when the system declined to answer.
 * The measures score its raw output. A completed row with neither `output` nor `pointer` lost its
 * output on the way: it is recorded as an infrastructure failure (`not-captured`), never scored.
 */
export interface CompletedRow extends ResultRowBase {
  /** How the trial ended. */
  readonly outcome: "completed" | "abstained";
  /**
   * The configuration the trial ran: its identity, or the configuration record. A trial that ran
   * another configuration than its arm's is an invalid configuration and gives no value.
   */
  readonly configuration: string | Configuration;
  /** The system's raw output, as JSON. */
  readonly output?: Json;
  /** Where the output is stored, when the row does not carry it. */
  readonly pointer?: string;
}

/**
 * A trial that did not complete, with the reason. A system failure or a budget overrun counts as a
 * failed trial on every measure that applies; an infrastructure failure or an invalid
 * configuration counts as missing, never as a failure of the system.
 */
export interface FailedRow extends ResultRowBase {
  /** How the trial ended. */
  readonly outcome:
    | "system_failure"
    | "infrastructure_failure"
    | "budget_exceeded"
    | "invalid_configuration";
  /** Why the trial did not complete, in one sentence. */
  readonly reason: string;
  /** The configuration the trial ran, if known. Absent means its arm's. */
  readonly configuration?: string | Configuration;
}

/**
 * One result of one planned trial, as a worker or a consumer's mapper writes it. A mapper of
 * another runner's files is a plain function that returns these rows.
 */
export type ResultRow = CompletedRow | FailedRow;

/** What `importResults` found, beside the records. */
export interface ImportSummary {
  /** The rows read. */
  readonly rows: number;
  /** The trial records made, one per row. */
  readonly trials: number;
  /** The measure values scored. */
  readonly values: number;
  /** The trials by recorded outcome. */
  readonly outcomes: Readonly<Partial<Record<Outcome, number>>>;
  /** The planned trials that no row reported: they are recorded as not run. */
  readonly notRun: number;
  /** Warnings about the rows, such as completed rows that lost their output. */
  readonly warnings: readonly string[];
  /** The keys some row carried that no result row defines, sorted. They are not recorded. */
  readonly unused: readonly string[];
}

const Configured = z.union([Text, Configuration]);

const Base = {
  case: Text,
  arm: Text,
  replicate: z.int().min(0),
  sourceId: Text.optional(),
  startedAt: Timestamp.optional(),
  endedAt: Timestamp.optional(),
  calls: z.int().min(0).optional(),
};

const Row = z.discriminatedUnion("outcome", [
  z.looseObject({
    ...Base,
    outcome: z.enum(["completed", "abstained"]),
    configuration: Configured,
    output: Json.optional(),
    pointer: Text.optional(),
  }),
  z.looseObject({
    ...Base,
    outcome: z.enum([
      "system_failure",
      "infrastructure_failure",
      "budget_exceeded",
      "invalid_configuration",
    ]),
    reason: Text,
    configuration: Configured.optional(),
  }),
]);

const KNOWN = new Set([
  ...Object.keys(Base),
  "outcome",
  "configuration",
  "output",
  "pointer",
  "reason",
]);

const UNKNOWN_RUNTIME: Runtime = {
  name: "unknown",
  version: "unknown",
  platform: "unknown",
  arch: "unknown",
};

/**
 * Turns result rows into the run's records: one trial record per row, the measure values that the
 * suite's scorers give each trial from its raw output, and the run with its ledger. It does no I/O
 * and never calls a model, so stored outputs can be scored again. It keeps the import rules: a
 * completed row with no captured output is an infrastructure failure (`not-captured`), never a
 * failure of the system; a failed trial never carries a passing value; a trial that ran another
 * configuration than its arm's is an invalid configuration and gives no value. A row the plan does
 * not list, a row without a required key, or a repeated trial throws an ImportError that names the
 * row. Keys that no row defines are reported as unused. Planned trials without a row are recorded
 * as not run.
 */
export function importResults(
  plan: SuitePlan,
  rows: Iterable<ResultRow>,
  options: {
    /** The runtime that imports the results, recorded in the run. Absent: recorded as unknown. */
    readonly runtime?: Runtime;
  } = {},
): { readonly records: RunRecords; readonly summary: ImportSummary } {
  const { record } = plan;
  const planned = new Map(record.trials.map((t) => [t.id as string, t]));
  const identities = new Map(record.arms.map((a) => [a.name as string, a.identity as string]));
  const cases = new Map(plan.suite.cases.map((c) => [c.id, Case.parse(c)]));
  const unused = new Set<string>();
  const trials: Trial[] = [];
  let index = 0;
  for (const input of rows) {
    index++;
    const parsed = Row.safeParse(input);
    if (!parsed.success)
      throw new ImportError(
        `row ${index} is not a valid result row:\n${z.prettifyError(parsed.error)}`,
      );
    const row = parsed.data;
    for (const key of Object.keys(row)) if (!KNOWN.has(key)) unused.add(key);
    const id = `${row.case}/${row.arm}/r${row.replicate}`;
    const p = planned.get(id);
    const c = cases.get(row.case);
    if (!p || !c) throw new ImportError(`row ${index}: trial '${id}' is not in the plan`);
    const configuration =
      row.configuration === undefined
        ? identities.get(row.arm)
        : typeof row.configuration === "string"
          ? row.configuration
          : configurationIdentity(row.configuration);
    const trial = Trial.parse({
      schema: "ichnaea.trial/1",
      id,
      source: "offline",
      run: plan.run,
      case: c.id,
      caseDigest: caseDigest(c),
      unit: c.unit,
      configuration,
      arm: row.arm,
      replicate: row.replicate,
      outcome: row.outcome,
      dataClass: c.dataClass,
      ...("output" in row && row.output !== undefined ? { output: row.output } : {}),
      ...("pointer" in row && row.pointer !== undefined ? { pointer: row.pointer } : {}),
      ...("reason" in row ? { error: { kind: row.outcome, message: row.reason } } : {}),
      ...(row.calls === undefined ? {} : { usage: { calls: row.calls } }),
      ...(row.startedAt === undefined ? {} : { startedAt: row.startedAt }),
      ...(row.endedAt === undefined ? {} : { endedAt: row.endedAt }),
    });
    trials.push(checkCaptured(checkConfiguration(trial, identities.get(row.arm))));
  }

  const problems = recordProblems({ trials, values: [], gates: [] });
  if (problems.length > 0) throw new ImportError(problems.join("; "));

  // Only the measures the plan names are scored, and an invalid configuration gives no value.
  const used = new Set(record.measures.map((m) => m.id as string));
  const measures = [...suiteMeasures(plan.suite).values()].filter((m) => used.has(m.card.id));
  const valid = new Set(
    trials.filter((t) => t.outcome !== "invalid_configuration").map((t) => t.id as string),
  );
  const values: MeasureValue[] = scoreTrials(measures, trials, cases).filter((v) =>
    valid.has(v.trial),
  );

  const recorded = new Map(trials.map((t) => [t.id as string, t.outcome]));
  const starts = trials.flatMap((t) => (t.startedAt === undefined ? [] : [t.startedAt]));
  const ends = trials.flatMap((t) => (t.endedAt === undefined ? [] : [t.endedAt]));
  const startedAt = starts.toSorted((a, b) => Date.parse(a) - Date.parse(b))[0] ?? record.createdAt;
  const completedAt = ends.toSorted((a, b) => Date.parse(b) - Date.parse(a))[0] ?? startedAt;
  const runtime = options.runtime ?? UNKNOWN_RUNTIME;
  const run = Run.parse({
    schema: "ichnaea.run/1",
    id: plan.run,
    plan: digest(record),
    exploratory: false,
    environment: {
      node: runtime.name === "node" ? runtime.version : runtime.name,
      platform: `${runtime.platform}-${runtime.arch}`,
      ichnaea: record.ichnaea,
      ...(runtime === UNKNOWN_RUNTIME ? {} : { arch: runtime.arch, runtime }),
    },
    arms: record.arms,
    lineage: [
      ...record.measures,
      { kind: "package", id: "@hephaestus-build/ichnaea", version: record.ichnaea },
    ],
    ledger: record.trials.map((t) => {
      const outcome = recorded.get(t.id);
      return outcome
        ? { trial: t.id, state: "recorded", outcome }
        : { trial: t.id, state: "planned", outcome: "not_run" };
    }),
    startedAt,
    completedAt,
  });

  const outcomes: Partial<Record<Outcome, number>> = {};
  for (const t of trials) outcomes[t.outcome] = (outcomes[t.outcome] ?? 0) + 1;
  const warnings: string[] = [];
  const lost = trials.filter((t) => t.error?.kind === NOT_CAPTURED);
  if (lost.length > 0)
    warnings.push(
      `${lost.length} completed row(s) had no captured output, for example '${lost[0]?.id}'; they count as missing trials, never as failures of the system`,
    );
  const mismatched = trials.filter((t) => t.error?.kind === "configuration-mismatch");
  if (mismatched.length > 0)
    warnings.push(
      `${mismatched.length} row(s) ran another configuration than their arm, for example '${mismatched[0]?.id}'; they give no value`,
    );
  return {
    records: { plan: record, run, trials, values, gates: [] },
    summary: {
      rows: index,
      trials: trials.length,
      values: values.length,
      outcomes,
      notRun: record.trials.length - trials.length,
      warnings,
      unused: [...unused].toSorted(),
    },
  };
}
