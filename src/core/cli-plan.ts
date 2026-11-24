import { join } from "node:path";

import { projectForEgress } from "../contracts/egress.ts";
import { AnalysisPlan } from "../contracts/records/analysis-plan.ts";
import { blockCalls } from "../plan/analysis.ts";
import { resolutionLine } from "../plan/resolution.ts";

import { planSuite, readLockedPlan, writeAnalysis } from "./analysis-plan.ts";
import { hostAndStore } from "./cli-config.ts";
import { CliError, type Command, CONFIG_OPTION, STORE_OPTION, text } from "./command-grammar.ts";
import { FileStore } from "./store.ts";
import { CORE_VERSION } from "./version.ts";

export const planCommand: Command = {
  name: "plan",
  description: "Write plan.json and ichnaea.lock beside the suite",
  options: {
    config: CONFIG_OPTION,
    store: STORE_OPTION,
    frozen: { type: "boolean", description: "Check the plan and lock without changing them" },
    pilot: { type: "string", description: "A stored noise run to use for the resolution estimate" },
  },
  async run(args, load) {
    const { host, store, config, directory } = await hostAndStore(args, load);
    if (!config.suite)
      throw new CliError("CONFIGURATION", "plan: the configuration must define a suite");
    const frozen = args.values["frozen"] === true;
    const prior = frozen ? await readLockedPlan(join(directory, "plan.json")) : undefined;
    const pilotId = text(args, "pilot") ?? prior?.pilot?.run;
    const pilot = pilotId === undefined ? undefined : await new FileStore(store).read(pilotId);
    const planned = await planSuite({
      ...(pilot === undefined ? {} : { pilot }),
      suite: config.suite,
      host,
      directory,
      ichnaea: CORE_VERSION,
    });
    await writeAnalysis(directory, planned, frozen);
    const { cases, holm, blocks, replicates, callsPerTrial } = planned.plan;
    const calls = blockCalls(
      cases.length,
      holm.length,
      blocks,
      replicates,
      callsPerTrial,
      config.suite.arms.candidate ? 2 : undefined,
    );
    const resolution = (planned.plan.resolution ?? []).map((entry) => resolutionLine(entry));
    return {
      code: 0,
      text: [
        [`plan: ${cases.length} cases, ${blocks} blocks, ${calls} calls`, ...resolution].join(
          " • ",
        ),
      ],
      json: projectForEgress(AnalysisPlan, planned.plan, { maxClass: "none", purpose: "PU-1" })
        .value,
    };
  },
};
