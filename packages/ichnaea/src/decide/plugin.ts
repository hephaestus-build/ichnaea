import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalize } from "../contracts/canonical.ts";
import type { Decision } from "../contracts/records/decision.ts";
import type { Plan } from "../contracts/records/plan.ts";
import type { CommandDefinition, Plugin } from "../core/plugin.ts";
import { FileStore } from "../core/store.ts";
import { CORE_VERSION } from "../core/version.ts";

import { decide } from "./decide.ts";
import { planningPower } from "./planning.ts";

const VERSION = CORE_VERSION;

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
      host.err("decide: --run is required");
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
      aa: await store.aaEvidence(stored.plan),
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
