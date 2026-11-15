import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type CommandDefinition, FileStore, type Plugin } from "@hephaestus-build/ichnaea-core";

import { recompute } from "./recompute.ts";
import { lintReport, renderHtml, renderMarkdown } from "./render.ts";
import { decisionView } from "./view.ts";

const command: CommandDefinition = {
  name: "report",
  description: "Render a stored decision as summary.md and report.html, after the recompute check",
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
    const stored = await new FileStore(storePath).read(runId);
    if (!stored.decision) {
      host.out(`report: run '${runId}' has no decision; run 'ichnaea decide' first`);
      return 2;
    }
    const check = await recompute({ ...stored, decision: stored.decision });
    if (!check.matches) {
      host.out(
        `report: the stored decision does not recompute from the stored records (${check.differences.join(", ")})`,
      );
      return 1;
    }
    const view = decisionView(stored.decision, stored.plan.suite);
    const markdown = renderMarkdown(view);
    const html = renderHtml(view);
    const problems = [...lintReport(markdown), ...lintReport(html)];
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
    version: "0.0.0",
    stability: "alpha",
    requires: { core: "^0.0.0" },
    commands: [command],
  };
}
