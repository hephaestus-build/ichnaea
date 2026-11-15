import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalize, type Decision, type Plan } from "@hephaestus-build/ichnaea-contracts";
import {
  sampledCasesFloor,
  VALIDATED_MARGIN_CEILING,
  VALIDATED_MARGIN_FLOOR,
  zeroNoiseFloor,
} from "@hephaestus-build/ichnaea-stats";
import {
  type CommandDefinition,
  FileStore,
  packageVersion,
  type PlanAdditions,
  type Plugin,
} from "@hephaestus-build/ichnaea-core";

import { decide, describeCounts, plannedTrialsPerCase } from "./decide.ts";

const VERSION = packageVersion(import.meta.url);

/**
 * The exit code a CI policy gives a decision (REQ-26, REQ-27): 1 blocks, 0 lets the change pass.
 * PASS never blocks, and INVALID always does: it never maps to a pass (REQ-53).
 */
export function exitCode(decision: Decision, policy: Plan["policy"]): number {
  if (decision.verdict === "INVALID") return 1;
  if (decision.verdict === "PASS") return 0;
  const action =
    decision.verdict === null
      ? policy.onEstimateOnly
      : decision.verdict === "REGRESSION"
        ? policy.onRegression
        : policy.onInconclusive;
  return action === "block" ? 1 : 0;
}

/**
 * The planning power statement (REQ-27, REQ-54): per primary measure, the zero-noise floor of the
 * fixed-cases bound for the plan's cases and trials. The floor is a lower bound on the minimum
 * detectable effect, so a margin below it can never be shown: the plan then runs estimate-only.
 * This statement, made before any call, is the only one that may switch a plan to estimate-only.
 *
 * Under fixed-cases, a primary measure whose effective margin (the declared margin less its safety
 * margin, which is what the comparison tests) lies outside the validated margins of the statistics
 * package is refused (decision 0012): below the floor no non-inferiority result is validated, and a
 * margin of 0 is no non-inferiority test at all; above the ceiling the validation studies do not
 * reach. Every declared margin is checked, a placeholder too, so a margin that can never decide is
 * refused before any call. Another estimand's method states its own validated domain.
 */
export function planningPower(plan: Plan): PlanAdditions {
  for (const p of plan.estimand === "fixed-cases" ? plan.primary : []) {
    const tested = p.margin - (p.safetyMargin ?? 0);
    const broken =
      tested < VALIDATED_MARGIN_FLOOR
        ? `below the validated margin floor of ${VALIDATED_MARGIN_FLOOR}`
        : tested > VALIDATED_MARGIN_CEILING
          ? `above the validated margin ceiling of ${VALIDATED_MARGIN_CEILING}`
          : undefined;
    if (broken)
      return {
        refuse: `primary measure '${p.measure}': its margin of ${p.margin} less its safety margin of ${p.safetyMargin ?? 0} is ${broken}, where no non-inferiority result is validated`,
      };
  }
  if (plan.mode !== "decision" || plan.estimand !== "fixed-cases") return {};
  const base = plan.arms.find((a) => a.role === "base")?.name ?? plan.arms[0]?.name ?? "";
  const counts = [...plannedTrialsPerCase(plan, base).values()];
  const floor = zeroNoiseFloor(counts, plan.alpha);
  const reasons: string[] = [];
  const power = plan.primary.map((p) => {
    const effective = p.margin - (p.safetyMargin ?? 0);
    const decidable = floor < effective;
    if (!decidable)
      reasons.push(
        `measure '${p.measure}': the zero-noise floor of ${(floor * 100).toFixed(1)} points is not below the margin of ${(effective * 100).toFixed(1)} points, so no run of this plan can show it non-inferior`,
      );
    return {
      computed: true as const,
      measure: p.measure,
      applicableCases: counts.length,
      replicates: Math.min(...counts),
      margin: p.margin,
      mde: floor,
      floor,
      sampledCasesFloor: sampledCasesFloor(counts.length, plan.alpha),
      assumption: `planning: no noise, every case applicable, trials per case ${describeCounts(counts)} (a lower bound on the MDE)`,
      decidable,
    };
  });
  return reasons.length > 0
    ? { power, mode: "estimate-only", modeReasons: [...plan.modeReasons, ...reasons] }
    : { power };
}

const command: CommandDefinition = {
  name: "decide",
  description:
    "Decide a stored run: write decision.json and a verdict file, exit by the plan's CI policy",
  options: {
    store: { type: "string", description: "The record store (default .ichnaea)" },
    run: { type: "string", description: "The run ID" },
    "verdict-file": {
      type: "string",
      description:
        "Where to write the machine-readable verdict (default <store>/runs/<run>/verdict.json)",
    },
    now: {
      type: "string",
      description:
        "The decision time (default: now). Fix it to reproduce a decision byte for byte.",
    },
  },
  async run({ values }, host) {
    const storePath = (values["store"] as string | undefined) ?? ".ichnaea";
    const runId = values["run"] as string | undefined;
    if (!runId) {
      host.out("decide: --run is required");
      return 2;
    }
    const store = new FileStore(storePath);
    const stored = await store.read(runId);
    const decision = await decide({
      plan: stored.plan,
      run: stored.run,
      trials: stored.trials,
      values: stored.values,
      gates: stored.gates,
      decidedAt: (values["now"] as string | undefined) ?? new Date().toISOString(),
      ichnaea: stored.plan.ichnaea,
    });
    await store.writeDecision(decision, stored.plan.suite);
    const verdictFile =
      (values["verdict-file"] as string | undefined) ??
      join(storePath, "runs", runId, "verdict.json");
    await writeFile(
      verdictFile,
      `${canonicalize({ run: decision.run, mode: decision.mode, verdict: decision.verdict, reason: decision.reason })}\n`,
    );
    await host.hooks.decisionMade(decision);
    host.out(`${decision.verdict ?? "ESTIMATE-ONLY"}: ${decision.reason}`);
    return exitCode(decision, stored.plan.policy);
  },
};

/** The decision plugin: the `decide` command over the record store. */
export function decidePlugin(): Plugin<"decide"> {
  return {
    id: "decide",
    version: VERSION,
    stability: "alpha",
    // The packages release in lockstep, so a plugin needs the core of its own version.
    requires: { core: `^${VERSION}` },
    commands: [command],
    hooks: { planCreated: (_ctx, plan) => planningPower(plan) },
  };
}
