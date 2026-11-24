import { canonicalize, digest } from "../contracts/canonical.ts";
import type { Case } from "../contracts/records/case.ts";
import { GateResult } from "../contracts/records/decision.ts";
import { Judge } from "../contracts/records/judge.ts";
import { MeasureValue } from "../contracts/records/measure.ts";
import { Plan } from "../contracts/records/plan.ts";
import { ExecutedBlock, Run } from "../contracts/records/run.ts";
import { Trial } from "../contracts/records/trial.ts";
import { recordProblems, type RunRecords } from "../contracts/run-records.ts";
import { proportionProblem } from "../contracts/values.ts";

import type { Host } from "./host.ts";
import { scoreTrials } from "./measures.ts";
import type { ImportResult } from "./plugin.ts";

/**
 * The error kind of a trial whose output was not captured. Such a trial is an infrastructure
 * failure, never a completed trial: it counts as missing, never as a failure of the system.
 */
export const NOT_CAPTURED = "not-captured";

/** Outcomes that score as a failed trial, whatever value a record carries (REQ-20). */
const FAILED_OUTCOMES: ReadonlySet<string> = new Set(["system_failure", "budget_exceeded"]);

/** Thrown when an importer's records cannot be stored. The message names the record. */
export class ImportError extends Error {
  /** The error's name, for `instanceof`-free checks. */
  override readonly name = "ImportError";
}

/**
 * Marks a trial whose configuration differs from its arm, or whose observations differ from what
 * the configuration expects (REQ-15), as an invalid configuration. Its outputs stay recorded; it
 * gives no value, so it counts as missing. A protocol failure stays one: it is the harness's fault
 * and makes the run INVALID, which an invalid configuration, counted only as missing, would not.
 */
function expectedObservation(arm: Plan["arms"][number], name: string): unknown {
  const { configuration } = arm;
  if (name === "configuration") return arm.identity;
  if (name === "model" && configuration.models.length === 1)
    return configuration.models[0]?.id.value;
  for (const model of configuration.models)
    if (name === `model.${model.role}`) return model.id.value;
  for (const parameter of configuration.parameters)
    if (name === `parameter.${parameter.name}`) return parameter.value;
  for (const prompt of configuration.prompts)
    if (name === `prompt.${prompt.name}`) return prompt.digest;
  if (name.startsWith("factor.")) {
    const factor = configuration.factors[name.slice("factor.".length)];
    if (factor && "value" in factor) return factor.value;
  }
  return undefined;
}

function checkConfiguration(
  trial: Trial,
  arm: Plan["arms"][number] | undefined,
  locked: boolean,
): Trial {
  if (trial.outcome === "invalid_configuration" || trial.outcome === "protocol_failure")
    return trial;
  const difference = trial.observed?.find((observation) => {
    const bound = locked && arm ? expectedObservation(arm, observation.name) : undefined;
    const expected = bound === undefined ? observation.expected : bound;
    return expected !== undefined && canonicalize(observation.value) !== canonicalize(expected);
  });
  const mismatch =
    arm?.identity !== trial.configuration
      ? `the trial ran configuration ${trial.configuration}, not its arm's ${arm?.identity ?? "(no arm)"}`
      : difference === undefined
        ? undefined
        : `observed ${difference.name} differs from the expected value`;
  if (mismatch === undefined) return trial;
  return {
    ...trial,
    outcome: "invalid_configuration",
    error: { kind: "configuration-mismatch", message: mismatch },
  };
}

/**
 * A trial is scored only on output that was captured (REQ-20). A completed record with neither
 * an output nor a pointer to one is a capture failure: an infrastructure failure, so it counts as
 * missing. An output the system returned empty is present, and is scored.
 */
function checkCaptured(trial: Trial): Trial {
  if (trial.outcome !== "completed" || trial.output !== undefined || trial.pointer !== undefined)
    return trial;
  return {
    ...trial,
    outcome: "infrastructure_failure",
    error: { kind: NOT_CAPTURED, message: "the record has no captured output" },
  };
}

/** Whether a value says that its trial passed: a binary pass, or a proportion with a success. */
function passing(value: MeasureValue["value"]): boolean {
  return (
    (value?.type === "binary" && value.pass) ||
    (value?.type === "proportion" && value.successes > 0)
  );
}

export interface RecordRunInput {
  readonly host: Host;
  readonly store: { createRun(records: RunRecords): Promise<void> };
  readonly plan: Plan;
  readonly cases: readonly Case[];
  readonly result: ImportResult;
  readonly id: string;
  readonly execution:
    | { readonly source: "import" | "re-score" }
    | { readonly source: "runner"; readonly blocks: readonly ExecutedBlock[] };
  readonly producer?: Run["lineage"][number];
  readonly startedAt: string;
  readonly completedAt: string;
}

/** Validate and seal the records that all evidence producers share. */
export async function recordRun(
  input: RecordRunInput,
): Promise<{ plan: Plan; trials: number; values: number }> {
  const { host, store, cases, result } = input;
  const plan = Plan.parse(input.plan);
  const analysisPlan = plan.analysis && digest(plan.analysis);
  if (input.execution.source === "runner" && !analysisPlan)
    throw new ImportError("runner evidence requires a locked analysis plan");
  if (
    plan.analysis &&
    (plan.analysis.suiteDigest !== plan.suiteDigest ||
      plan.analysis.caseSetDigest !== plan.caseSetDigest)
  )
    throw new ImportError("the bound plan disagrees with the analysis plan");
  const blocks =
    input.execution.source === "runner"
      ? input.execution.blocks.map((block) => ExecutedBlock.parse(block))
      : undefined;
  const byBlock = new Map(blocks?.map((block) => [block.block, block]));
  if (blocks && byBlock.size !== blocks.length) throw new ImportError("duplicate execution block");
  const completed = blocks?.filter((block) => block.status === "complete") ?? [];
  if (new Set(completed.map((block) => block.plannedBlock)).size !== completed.length)
    throw new ImportError("multiple completed blocks occupy one planned block");
  const plannedBlocks = plan.analysis?.blocks;
  if (plannedBlocks !== undefined && blocks?.some((block) => block.plannedBlock >= plannedBlocks))
    throw new ImportError("execution includes an unplanned block");

  const offered = {
    trials: result.trials.map((trial) => Trial.parse(trial)),
    values: result.values.map((value) => MeasureValue.parse(value)),
    gates: (result.gates ?? []).map((gate) => GateResult.parse(gate)),
  };
  const duplicate = recordProblems(offered)[0];
  if (duplicate) throw new ImportError(duplicate);
  const planned = new Map(plan.trials.map((trial) => [trial.id, trial]));
  const arms = new Map(plan.arms.map((arm) => [arm.name, arm]));
  const trials = offered.trials.map((trial) => {
    const slot = planned.get(trial.id);
    if (!slot)
      throw new ImportError(
        `the importer returned trial '${trial.id}', which the plan does not list`,
      );
    if (trial.case !== slot.case || trial.arm !== slot.arm || trial.replicate !== slot.replicate)
      throw new ImportError(
        `trial '${trial.id}' is planned as case '${slot.case}', arm '${slot.arm}', replicate ${slot.replicate}`,
      );
    if (
      analysisPlan &&
      (trial.analysisPlan !== undefined || blocks) &&
      trial.analysisPlan !== analysisPlan
    )
      throw new ImportError(
        `trial '${trial.id}' belongs to another analysis plan or carries no digest`,
      );
    if (blocks && trial.block !== undefined) {
      const block = byBlock.get(trial.block);
      if (block?.status !== "complete" || block.plannedBlock !== slot.block)
        throw new ImportError(`trial '${trial.id}' belongs to an abandoned or unplanned block`);
    }
    const observed = checkConfiguration(trial, arms.get(slot.arm), analysisPlan !== undefined);
    return checkCaptured(analysisPlan ? Trial.parse({ ...observed, analysisPlan }) : observed);
  });
  const byTrial = new Map(trials.map((t) => [t.id as string, t]));

  // Values: imported ones for measures the application computes, scored ones for Ichnaea's.
  const planMeasures = new Set(plan.measures.map((m) => m.id));
  const primary = new Set(plan.primary.map(({ measure }) => measure));
  const masks: Readonly<Record<string, readonly string[]>> | undefined =
    plan.analysis?.applicability;
  const maskByMeasure = new Map(
    Object.entries(masks ?? {}).map(([id, caseIds]) => [id, new Set(caseIds)]),
  );
  const valuesOutsideMask: Record<string, number> = {};
  const judges = new Map(
    (result.judges ?? []).map((record) => {
      const judge = Judge.parse(record);
      return [judge.id, judge];
    }),
  );
  if (judges.size !== (result.judges ?? []).length)
    throw new ImportError("duplicate judge identity");
  const usedJudges = new Set<Judge["id"]>();
  const supplied: MeasureValue[] = [];
  for (const v of offered.values) {
    const measure = host.measures.get(v.measure);
    if (!measure || !planMeasures.has(v.measure))
      throw new ImportError(`value for measure '${v.measure}', which the plan does not use`);
    const trial = byTrial.get(v.trial);
    if (!trial)
      throw new ImportError(
        `value for '${v.measure}' names trial '${v.trial}', which was not imported`,
      );
    const mask = maskByMeasure.get(v.measure);
    if (mask && trial.case !== null && !mask.has(trial.case)) {
      if (v.applicable) valuesOutsideMask[v.measure] = (valuesOutsideMask[v.measure] ?? 0) + 1;
      continue;
    }
    if (primary.has(v.measure) && v.source === "judge")
      throw new ImportError(`judge-sourced value for primary measure '${v.measure}'`);
    if (measure.card.computedBy === "ichnaea")
      throw new ImportError(
        `measure '${v.measure}' is computed by Ichnaea; do not import its values`,
      );
    if (v.source !== measure.card.computedBy)
      throw new ImportError(`source '${v.source}' does not match the card for '${v.measure}'`);
    if (v.source === "judge") {
      const id = measure.card.judge;
      if (id === undefined || !judges.has(id))
        throw new ImportError(`judge lineage is missing for '${v.measure}'`);
      usedJudges.add(id);
    }
    if (v.version !== measure.card.version)
      throw new ImportError(
        `value for '${v.measure}' on '${v.trial}' has version ${v.version}, but the card is ${measure.card.version}`,
      );
    supplied.push(v);
    if (!v.applicable) {
      if (v.value !== undefined)
        throw new ImportError(`not-applicable value for '${v.measure}' carries an outcome`);
      continue;
    }
    if (v.value === undefined)
      throw new ImportError(`value for '${v.measure}' on '${v.trial}' is applicable but empty`);
    if (v.value.type !== measure.card.valueType)
      throw new ImportError(
        `value for '${v.measure}' on '${v.trial}' is ${v.value.type}, but the card says ${measure.card.valueType} (REQ-31)`,
      );
    const problem = proportionProblem(v.value);
    if (problem) throw new ImportError(`value for '${v.measure}' on '${v.trial}': ${problem}`);
    const outcome = trial.outcome;
    // A record that contradicts itself is a defect in the importer, not evidence about the system.
    if (FAILED_OUTCOMES.has(outcome) && passing(v.value))
      throw new ImportError(
        `trial '${v.trial}' is a ${outcome} but carries a passing value for '${v.measure}'; a failed trial cannot pass, so fix the importer`,
      );
  }
  const byCase = new Map(cases.map((c) => [c.id as string, c]));
  const valid = new Set(
    trials.filter((t) => t.outcome !== "invalid_configuration").map((t) => t.id),
  );
  const values: MeasureValue[] = [
    ...supplied,
    ...scoreTrials(
      [...host.measures.values()].filter((m) => planMeasures.has(m.card.id)),
      trials,
      byCase,
      plan.analysis?.applicability,
    ),
  ].filter((v) => valid.has(v.trial));

  // Gates: a gate with a check is computed here; the importer reports only gates without one.
  const gates: GateResult[] = [];
  for (const g of offered.gates) {
    const definition = host.gates.get(g.gate);
    if (!definition || !plan.hardGates.includes(g.gate))
      throw new ImportError(`gate result for '${g.gate}', which the plan does not use`);
    if (definition.check)
      throw new ImportError(`gate '${g.gate}' is computed by its check; do not import its result`);
    gates.push(g);
  }
  for (const id of plan.hardGates) {
    const check = host.gates.get(id)?.check;
    if (check) gates.push(GateResult.parse({ ...check({ trials, cases }), gate: id }));
  }
  for (const g of gates)
    if (g.passed === g.failures > 0)
      throw new ImportError(
        `gate '${g.gate}': passed is ${g.passed} with ${g.failures} failure(s)`,
      );

  const problems = recordProblems({ trials, values, gates });
  if (problems.length > 0) throw new ImportError(problems.join("; "));

  const recorded = new Map(trials.map((t) => [t.id as string, t.outcome]));
  const lineage: Run["lineage"] = [
    ...host.plugins.map((p) => ({ kind: "plugin" as const, id: p.id, version: p.version })),
    ...(input.producer ? [input.producer] : []),
    ...[...judges.values()]
      .filter(({ id }) => usedJudges.has(id))
      .map((judge) => ({
        kind: "judge" as const,
        id: judge.id,
        version: judge.version,
        digest: digest(judge),
      })),
    ...plan.measures,
    ...plan.hardGates.map((id) => ({
      kind: "gate" as const,
      id,
      version: host.gates.get(id)?.version ?? "unknown",
    })),
    { kind: "package", id: "@tumaet/ichnaea", version: plan.ichnaea },
  ];
  const run = Run.parse({
    schema: "ichnaea.run/1",
    id: input.id,
    plan: digest(plan),
    exploratory:
      input.execution.source === "re-score" ||
      (analysisPlan !== undefined && input.execution.source === "import"),
    ...(analysisPlan === undefined
      ? {}
      : {
          execution: {
            source: input.execution.source,
            analysisPlan,
            ...(blocks === undefined ? {} : { blocks }),
          },
          ...(Object.keys(valuesOutsideMask).length > 0 ? { valuesOutsideMask } : {}),
        }),
    environment: {
      node: process.versions.node,
      platform: `${process.platform}-${process.arch}`,
      ichnaea: plan.ichnaea,
      arch: process.arch,
      runtime: {
        name: "node",
        version: process.versions.node,
        platform: process.platform,
        arch: process.arch,
      },
    },
    arms: plan.arms,
    lineage,
    ledger: plan.trials.map((t) => {
      const outcome = recorded.get(t.id);
      // A planned trial the importer did not return never ran.
      return outcome
        ? { trial: t.id, state: "recorded", outcome }
        : { trial: t.id, state: "planned", outcome: "not_run" };
    }),
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  });

  await store.createRun({ plan, run, trials, values, gates });
  return { plan, trials: trials.length, values: values.length };
}
