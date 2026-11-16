import type * as z from "zod";

import { Case, CaseSet } from "./records/case.ts";
import { Configuration } from "./records/configuration.ts";
import { Decision } from "./records/decision.ts";
import { Calibration, Judge, Label } from "./records/judge.ts";
import { MeasureCard, MeasureValue } from "./records/measure.ts";
import { Finding, Monitor } from "./records/monitor.ts";
import { Plan } from "./records/plan.ts";
import { Run } from "./records/run.ts";
import { Suite } from "./records/suite.ts";
import { Trial } from "./records/trial.ts";

/** Stability level of a record schema (OpenTelemetry levels; names never encode the stage). */
export type Stability = "development" | "alpha" | "beta" | "stable";

/** One record contract: its schema identifier, zod schema and stability. */
export interface RecordContract {
  /** The record's name, such as `caseSet`; it names the generated JSON Schema files. */
  readonly name: string;
  /**
   * The schema identifier, such as `ichnaea.case/1`, that a record of this kind carries in
   * `schema`.
   */
  readonly id: string;
  /** The zod schema that a writer validates the record against. */
  readonly schema: z.ZodType;
  /** The stability level of the schema. */
  readonly stability: Stability;
  /** One sentence that says what the record is, for the generated JSON Schema. */
  readonly description: string;
}

/** Every record contract, by name. The generated JSON Schema files follow this list. */
export const RECORD_CONTRACTS: readonly RecordContract[] = [
  {
    name: "case",
    id: "ichnaea.case/1",
    schema: Case,
    stability: "alpha",
    description: "One evaluation input with fixtures and hidden references.",
  },
  {
    name: "caseSet",
    id: "ichnaea.caseSet/1",
    schema: CaseSet,
    stability: "alpha",
    description: "A versioned collection of cases identified by a digest.",
  },
  {
    name: "configuration",
    id: "ichnaea.configuration/1",
    schema: Configuration,
    stability: "alpha",
    description: "A resolved system configuration with factor statuses.",
  },
  {
    name: "suite",
    id: "ichnaea.suite/1",
    schema: Suite,
    stability: "alpha",
    description: "What an application evaluates, without naming a system.",
  },
  {
    name: "plan",
    id: "ichnaea.plan/1",
    schema: Plan,
    stability: "alpha",
    description: "The resolved, locked form of a suite for one run.",
  },
  {
    name: "trial",
    id: "ichnaea.trial/1",
    schema: Trial,
    stability: "alpha",
    description: "The normalised evidence of one trial.",
  },
  {
    name: "run",
    id: "ichnaea.run/1",
    schema: Run,
    stability: "alpha",
    description: "The ledger of a plan's trials with lineage.",
  },
  {
    name: "measureCard",
    id: "ichnaea.measureCard/1",
    schema: MeasureCard,
    stability: "alpha",
    description: "The definition of a measure.",
  },
  {
    name: "measureValue",
    id: "ichnaea.measureValue/1",
    schema: MeasureValue,
    stability: "alpha",
    description: "One measure value on one trial.",
  },
  {
    name: "decision",
    id: "ichnaea.decision/1",
    schema: Decision,
    stability: "alpha",
    description: "The verdict of one run with estimates, intervals and flips.",
  },
  {
    name: "judge",
    id: "ichnaea.judge/1",
    schema: Judge,
    stability: "development",
    description: "A model-based instrument for a measure, defined as data.",
  },
  {
    name: "label",
    id: "ichnaea.label/1",
    schema: Label,
    stability: "development",
    description: "One annotation on one trial for one measure.",
  },
  {
    name: "calibration",
    id: "ichnaea.calibration/1",
    schema: Calibration,
    stability: "development",
    description: "Agreement between a judge and human labels, with a status.",
  },
  {
    name: "monitor",
    id: "ichnaea.monitor/1",
    schema: Monitor,
    stability: "development",
    description: "An online or scheduled check with an owner and an action.",
  },
  {
    name: "finding",
    id: "ichnaea.finding/1",
    schema: Finding,
    stability: "development",
    description: "A confirmed failure with pointers, promotable to a case.",
  },
];

/** Returns the contract for a schema identifier such as `ichnaea.trial/1`. */
export function contractFor(id: string): RecordContract | undefined {
  return RECORD_CONTRACTS.find((c) => c.id === id);
}
