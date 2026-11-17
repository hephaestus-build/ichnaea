import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { CommandDefinition, Plugin } from "../core/plugin.ts";
import { FileStore } from "../core/store.ts";
import { CORE_VERSION } from "../core/version.ts";

import { recompute } from "./recompute.ts";
import { lintReport, renderHtml, renderMarkdown } from "./render.ts";
import { decisionView } from "./view.ts";

const VERSION = CORE_VERSION;

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
    const store = new FileStore(storePath);
    const stored = await store.read(runId);
    if (!stored.decision) {
      host.out(`report: run '${runId}' has no decision; run 'ichnaea decide' first`);
      return 2;
    }
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
    const view = decisionView(stored.decision, stored.plan.suite, stored.run.lineage);
    const markdown = renderMarkdown(view);
    const html = renderHtml(view);
    const neutral = decisionView(stored.decision, stored.plan.suite, stored.run.lineage, {
      neutral: true,
    });
    const problems = [
      ...lintReport(renderMarkdown(neutral)),
      ...lintReport(renderHtml(neutral)),
      ...(/Lineage/.test(markdown) && /Lineage/.test(html) ? [] : ["no lineage footer"]),
    ];
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
