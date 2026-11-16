import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FileStore, CORE_VERSION } from "../core/index.js";
import { recompute } from "./recompute.js";
import { lintReport, neutralView, renderHtml, renderMarkdown } from "./render.js";
import { decisionView } from "./view.js";
const VERSION = CORE_VERSION;
const command = {
    name: "report",
    description: "Render a stored decision as summary.md and report.html, after the recompute check",
    options: {
        store: { type: "string", description: "The record store (default .ichnaea)" },
        run: { type: "string", description: "The run ID" },
        out: { type: "string", description: "Output directory (default <store>/runs/<run>/report)" },
    },
    async run({ values }, host) {
        const storePath = values["store"] ?? ".ichnaea";
        const runId = values["run"];
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
            host.out(`report: the stored decision does not recompute from the stored records (${check.differences.join(", ")})`);
            return 1;
        }
        const view = decisionView(stored.decision, stored.plan.suite, stored.run.lineage);
        const markdown = renderMarkdown(view);
        const html = renderHtml(view);
        const neutral = neutralView(view);
        const problems = [
            ...lintReport(renderMarkdown(neutral)),
            ...lintReport(renderHtml(neutral)),
            ...(/Lineage/.test(markdown) && /Lineage/.test(html) ? [] : ["no lineage footer"]),
        ];
        if (problems.length > 0) {
            host.out(`report: ${problems.join("; ")}`);
            return 1;
        }
        const out = values["out"] ?? join(storePath, "runs", runId, "report");
        await mkdir(out, { recursive: true });
        const files = [join(out, "summary.md"), join(out, "report.html")];
        await writeFile(files[0], markdown);
        await writeFile(files[1], html);
        await host.hooks.reportRendered(files);
        host.out(`report: ${files.join(", ")}`);
        return 0;
    },
};
/** The report plugin: the `report` command. */
export function reportPlugin() {
    return {
        id: "report",
        version: VERSION,
        stability: "alpha",
        // The packages release in lockstep, so a plugin needs the core of its own version.
        requires: { core: `^${VERSION}` },
        commands: [command],
    };
}
//# sourceMappingURL=plugin.js.map