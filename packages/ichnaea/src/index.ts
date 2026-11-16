// The package's main export: the core with its CLI, the decision rule and the reports. The record
// contracts and the statistics have their own subpaths, `./contracts` and `./stats`.
export * from "./core/index.ts";
export * from "./decide/index.ts";
export * from "./report/index.ts";

// The record and statistics types that the main export's signatures name, so a consumer can write
// them, for example `appliesTo: (c: Case) => …`, while importing only from `.`. Type-only: they add
// no runtime import, and the schemas stay in `./contracts`.
export type {
  Case,
  Configuration,
  DATA_CLASSES,
  DataClass,
  Decision,
  Estimand,
  FactorPart,
  GateResult,
  MeasureCard,
  MeasuredValue,
  MeasureValue,
  Outcome,
  Plan,
  Purpose,
  PURPOSES,
  Real,
  Run,
  Runtime,
  Trial,
  TrialResult,
} from "./contracts/index.ts";
export type {
  ArmCounts,
  CaseCounts,
  Comparison,
  Count,
  Interval,
  OneTrialChecks,
  Sided,
  Validity,
} from "./stats/index.ts";
// The statistics name the same two estimands with a type of their own (they import nothing from
// the contracts), so `.` exports it under its own name beside the contracts' `Estimand`.
export type { Estimand as StatsEstimand } from "./stats/index.ts";
