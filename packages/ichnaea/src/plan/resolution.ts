import { digest } from "../contracts/canonical.ts";
import { Resolution } from "../contracts/records/resolution.ts";
import type { AnalysisPlan } from "../contracts/records/analysis-plan.ts";
import type { RunRecords } from "../contracts/run-records.ts";

import {
  type BlockPowerInput,
  blockPower,
  blockResolution,
  defaultBaseRates,
  TARGET_BLOCK_POWER,
} from "../stats/block-resolution.ts";
import { DEFAULT_BLOCK_DROPS } from "../stats/block-resolution-table.ts";

import { blockCalls, defaultBlocks } from "./analysis.ts";
import { FAILED_TRIAL_OUTCOMES } from "./trial-counting.ts";
import { PlanError } from "./resolve.ts";

const MAX_SIMULATED_BLOCKS = 12;
const MAX_SIMULATED_TRIALS_PER_ARM = 10_000;

function simulationFits(input: BlockPowerInput): boolean {
  return (
    input.blocks <= MAX_SIMULATED_BLOCKS &&
    input.baseRates.length * input.blocks * input.replicates <= MAX_SIMULATED_TRIALS_PER_ARM
  );
}

function measurePower(
  analysis: AnalysisPlan,
  primary: AnalysisPlan["primary"][number],
  baseRates: readonly number[],
  basis: Resolution["basis"],
  missing?: string,
): Resolution {
  const family = analysis.holm.length;
  const level = analysis.alpha / family;
  const input = { baseRates, blocks: analysis.blocks, replicates: analysis.replicates, level };
  const unavailable =
    missing ??
    (analysis.method === "estimate-only" ? "the plan has no block comparison method" : undefined) ??
    (baseRates.length === 0 ? "no applicable cases" : undefined) ??
    (simulationFits(input) ? undefined : "the horizon exceeds the planning simulation domain");
  const tableDrop =
    basis === "default-simulation" &&
    analysis.alpha === 0.05 &&
    input.replicates === 1 &&
    input.blocks === defaultBlocks(family, analysis.alpha)
      ? DEFAULT_BLOCK_DROPS[baseRates.length]?.[family - 1]
      : undefined;
  const result =
    unavailable !== undefined
      ? { kind: "unavailable", reason: unavailable }
      : tableDrop === undefined
        ? blockResolution(input)
        : { kind: "detectable-drop", drop: tableDrop };
  return Resolution.parse({
    measure: primary.measure,
    basis,
    targetPower: TARGET_BLOCK_POWER,
    level,
    result,
    ...(primary.targetDrop === undefined
      ? {}
      : {
          targetDrop: primary.targetDrop,
          ...(unavailable === undefined
            ? { powerAtTarget: blockPower(input, primary.targetDrop) }
            : {}),
        }),
  });
}

function validatePilot(analysis: AnalysisPlan, pilot: RunRecords): void {
  const arms = pilot.plan.arms.filter((arm) => arm.role === "base" || arm.role === "candidate");
  if (
    pilot.run.plan !== digest(pilot.plan) ||
    pilot.plan.caseSetDigest !== analysis.caseSetDigest ||
    arms.length !== 2 ||
    arms.some((arm) => arm.identity !== analysis.base.identity) ||
    digest(pilot.plan.analysis?.applicability ?? {}) !== digest(analysis.applicability) ||
    digest(pilot.plan.analysis?.measures ?? []) !== digest(analysis.measures)
  )
    throw new PlanError(
      "the pilot must compare this base with itself on the same cases, masks and measures",
    );
}

function pilotRates(pilot: RunRecords, measure: string): ReadonlyMap<string, number> {
  const outcomes = new Map(
    pilot.values.filter((value) => value.measure === measure).map((value) => [value.trial, value]),
  );
  const counted = new Set(
    pilot.plan.arms.filter((arm) => arm.role !== "reference").map((arm) => arm.name),
  );
  const counts = new Map<string, { trials: number; passes: number }>();
  for (const trial of pilot.trials) {
    if (trial.case === null || trial.cache?.hit || !trial.arm || !counted.has(trial.arm)) continue;
    const value = outcomes.get(trial.id);
    if (value?.applicable === false) continue;
    const failed = FAILED_TRIAL_OUTCOMES.has(trial.outcome);
    if (!failed && (trial.outcome !== "completed" || value?.value?.type !== "binary")) continue;
    const count = counts.get(trial.case) ?? { trials: 0, passes: 0 };
    count.trials++;
    if (!failed && value?.value?.type === "binary" && value.value.pass) count.passes++;
    counts.set(trial.case, count);
  }
  return new Map([...counts].map(([id, count]) => [id, count.passes / count.trials]));
}

function forMask(
  mask: readonly string[],
  rates: ReadonlyMap<string, number>,
): number[] | undefined {
  const result: number[] = [];
  for (const id of mask) {
    const rate = rates.get(id);
    if (rate === undefined) return undefined;
    result.push(rate);
  }
  return result;
}

/** Locks planning resolution using a matching A/A pilot or the default simulation model. */
export function planResolution(
  analysis: AnalysisPlan,
  fixedBlocks: boolean,
  maxCalls: number | undefined,
  pilot: RunRecords | undefined,
): Pick<AnalysisPlan, "blocks" | "maxCalls" | "resolution" | "pilot"> {
  if (pilot) validatePilot(analysis, pilot);
  const basis = pilot ? "noise-pilot" : "default-simulation";
  const measures = analysis.primary.map((measure) => {
    const mask = analysis.applicability[measure.measure] ?? [];
    const rates = pilot
      ? forMask(mask, pilotRates(pilot, measure.measure))
      : defaultBaseRates(mask.length);
    return { measure, rates };
  });
  const perBlock = blockCalls(analysis.cases.length, analysis.holm.length, 1, analysis.replicates);
  const targets = measures.filter(({ measure }) => measure.targetDrop !== undefined);
  let blocks = analysis.blocks;
  if (!fixedBlocks && targets.length > 0) {
    const limit = Math.min(MAX_SIMULATED_BLOCKS, Math.floor((maxCalls ?? Infinity) / perBlock));
    const level = analysis.alpha / analysis.holm.length;
    for (let candidate = blocks - 1; candidate <= limit; candidate++) {
      const meets = targets.every(({ measure, rates }) => {
        const input = {
          baseRates: rates ?? [],
          blocks: candidate,
          replicates: analysis.replicates,
          level,
        };
        return (
          rates !== undefined &&
          rates.length > 0 &&
          simulationFits(input) &&
          blockPower(input, measure.targetDrop ?? 1) >= TARGET_BLOCK_POWER
        );
      });
      if (meets) {
        blocks = candidate;
        break;
      }
    }
  }
  const selected = { ...analysis, blocks };
  return {
    blocks,
    maxCalls: maxCalls ?? perBlock * blocks,
    ...(pilot ? { pilot: { run: pilot.run.id, digest: digest(pilot.run) } } : {}),
    resolution: measures.map(({ measure, rates }) =>
      measurePower(
        selected,
        measure,
        rates ?? [],
        basis,
        rates ? undefined : "the pilot has no rate for every applicable case",
      ),
    ),
  };
}

/** Computes the run-time statement from the observed base arm if the plan had no pilot. */
export function runResolution(
  analysis: AnalysisPlan,
  rates: (measure: string) => ReadonlyMap<string, number>,
  invalid: boolean,
): Resolution[] {
  return analysis.primary.map((measure) => {
    const locked = analysis.resolution?.find((entry) => entry.measure === measure.measure);
    if (locked?.basis === "noise-pilot" && !invalid) return locked;
    const observed = forMask(analysis.applicability[measure.measure] ?? [], rates(measure.measure));
    return measurePower(
      analysis,
      measure,
      observed ?? [],
      locked?.basis === "noise-pilot" ? "noise-pilot" : "base-arm-rates",
      invalid
        ? "run invalid"
        : observed === undefined
          ? "a planned applicable case has no base value"
          : undefined,
    );
  });
}

/** Renders the estimate and its model in one line. */
export function resolutionLine(entry: Resolution, measure: string = entry.measure): string {
  const { basis, targetPower, result } = entry;
  const from =
    basis === "noise-pilot"
      ? "A/A pilot"
      : basis === "base-arm-rates"
        ? "observed base-arm rates"
        : "default simulation, base rates 60–100%";
  if (result.kind === "unavailable") return `${measure}: resolution unavailable (${result.reason})`;
  const estimate =
    result.kind === "detectable-drop"
      ? `detects a drop of ${Math.round(result.drop * 100)} points at ${Math.round(targetPower * 100)}% power`
      : `${Math.round(result.power * 100)}% power if every candidate trial fails`;
  const target =
    entry.targetDrop !== undefined && entry.powerAtTarget !== undefined
      ? `, ${Math.round(entry.powerAtTarget * 100)}% power at the ${Math.round(entry.targetDrop * 100)}-point target${entry.powerAtTarget < targetPower ? " (below target power at this horizon)" : ""}`
      : "";
  return `${measure}: ${estimate}${target} (${from}, independent trials without block shocks)`;
}
