import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalize, type Decision } from "@hephaestus-build/ichnaea-contracts";
import { type CommandDefinition, FileStore, type Plugin } from "@hephaestus-build/ichnaea-core";

import { decide } from "./decide.ts";

/** The exit code a CI policy gives a decision (REQ-26, REQ-27). */
export function exitCode(
  decision: Decision,
  policy: {
    onRegression: string;
    onInconclusive: string;
    onEstimateOnly: string;
    onInvalid: string;
  },
): number {
  const action =
    decision.verdict === null
      ? policy.onEstimateOnly
      : decision.verdict === "REGRESSION"
        ? policy.onRegression
        : decision.verdict === "INCONCLUSIVE"
          ? policy.onInconclusive
          : decision.verdict === "INVALID"
            ? policy.onInvalid
            : "report";
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
    version: "0.0.0",
    stability: "alpha",
    requires: { core: "^0.0.0" },
    commands: [command],
  };
}
