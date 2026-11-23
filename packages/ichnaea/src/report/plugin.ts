import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalize, digest } from "../contracts/canonical.ts";
import { mustNeverResults } from "../core/never-measure.ts";
import type { CommandDefinition, Plugin } from "../core/plugin.ts";
import { FileStore } from "../core/store.ts";
import { runReduction } from "../core/trial-reduction.ts";
import { CORE_VERSION } from "../core/version.ts";

import { oneArmView } from "./one-arm.ts";
import { recompute } from "./recompute.ts";
import {
  lintReport,
  renderHtml,
  renderMarkdown,
  renderRunHtml,
  renderRunMarkdown,
} from "./render.ts";
import { decisionView } from "./view.ts";

const VERSION = CORE_VERSION;

const command: CommandDefinition = {
  name: "report",
  description:
    "Render a stored decision or one-arm run as summary.md and report.html, after the recompute check",
  options: {
    store: { type: "string", description: "The record store (default .ichnaea)" },
    run: { type: "string", description: "The run ID" },
    out: { type: "string", description: "Output directory (default <store>/runs/<run>/report)" },
  },
  async run({ values }, host) {
    const storePath = (values["store"] as string | undefined) ?? ".ichnaea";
    const runId = values["run"] as string | undefined;
    if (!runId) {
      host.out("report: --run is required");
      return 2;
    }
    const store = new FileStore(storePath);
    const stored = await store.read(runId);
    const oneArm = stored.plan.arms.length === 1;
    if (!stored.decision && !oneArm) {
      host.out(`report: run '${runId}' has no decision; run 'ichnaea decide' first`);
      return 2;
    }
    if (stored.decision) {
      const check = await recompute({
        ...stored,
        decision: stored.decision,
        aa: await store.aaEvidence(stored.plan),
      });
      if (!check.matches) {
        host.out(
          `report: the stored decision does not recompute from the stored records (${check.differences.join(", ")})`,
        );
        return 1;
      }
    }
    if (
      oneArm &&
      (stored.run.plan !== (await digest(stored.plan)) ||
        canonicalize(stored.run.trialReduction ?? null) !==
          canonicalize(runReduction(stored.plan, stored.trials, stored.values) ?? null) ||
        canonicalize(stored.run.mustNever ?? null) !==
          canonicalize(mustNeverResults(stored.plan, stored.trials, stored.values) ?? null))
    ) {
      host.out("report: the one-arm run does not match its stored plan and trial records");
      return 1;
    }

    const previous =
      oneArm && stored.run.previousRun ? await store.read(stored.run.previousRun) : undefined;
    if (
      previous &&
      (previous.plan.arms.length !== 1 ||
        previous.plan.suiteDigest !== stored.plan.suiteDigest ||
        previous.plan.caseSetDigest !== stored.plan.caseSetDigest ||
        previous.run.plan !== (await digest(previous.plan)))
    ) {
      host.out("report: the previous run does not match the stored suite and case set");
      return 1;
    }
    const render = (neutral: boolean): readonly [string, string] => {
      const summary = oneArm ? oneArmView(stored, previous, neutral) : undefined;
      if (stored.decision) {
        const view = decisionView(stored.decision, stored.plan.suite, stored.run.lineage, {
          neutral,
        });
        return [renderMarkdown(view, summary?.tables), renderHtml(view, summary?.tables)] as const;
      }
      if (!summary) throw new Error("no report view");
      return [renderRunMarkdown(summary), renderRunHtml(summary)] as const;
    };
    const [markdown, html] = render(false);
    const problems = render(true).flatMap(lintReport);
    if (problems.length > 0) {
      host.out(`report: ${problems.join("; ")}`);
      return 1;
    }
    const out = (values["out"] as string | undefined) ?? join(storePath, "runs", runId, "report");
    await mkdir(out, { recursive: true });
    const files = [join(out, "summary.md"), join(out, "report.html")];
    await writeFile(files[0] as string, markdown);
    await writeFile(files[1] as string, html);
    await host.hooks.reportRendered(files);
    host.out(`report: ${files.join(", ")}`);
    return 0;
  },
};

/** The report plugin: the `report` command. */
export function reportPlugin(): Plugin<"report"> {
  return {
    id: "report",
    version: VERSION,
    stability: "alpha",
    // The packages release in lockstep, so a plugin needs the core of its own version.
    requires: { core: `^${VERSION}` },
    commands: [command],
  };
}
