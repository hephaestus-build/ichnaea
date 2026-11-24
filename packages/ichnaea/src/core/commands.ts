import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalize } from "../contracts/canonical.ts";
import { exitCode } from "../decide/ci-policy.ts";
import { decide } from "../decide/decide.ts";
import { recompute } from "../report/recompute.ts";
import { lintReport, renderHtml, renderMarkdown } from "../report/render.ts";
import { decisionView } from "../report/view.ts";

import { FileStore } from "./store.ts";

/** A built-in command with options described by its help text. */
export interface CommandDefinition {
  readonly name: string;
  readonly description: string;
  readonly options: Readonly<
    Record<
      string,
      {
        readonly type: "string";
        readonly description: string;
      }
    >
  >;
  readonly run: (
    values: Readonly<Record<string, unknown>>,
    io: { readonly out: (text: string) => void; readonly err: (text: string) => void },
  ) => Promise<number>;
}

export const decideCommand: CommandDefinition = {
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
  async run(values, { out, err }) {
    const storePath = (values["store"] as string | undefined) ?? ".ichnaea";
    const runId = values["run"] as string | undefined;
    if (!runId) {
      err("decide: --run is required");
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
    out(`${decision.verdict ?? "ESTIMATE-ONLY"}: ${decision.reason}`);
    return exitCode(decision, stored.plan.policy);
  },
};

export const reportCommand: CommandDefinition = {
  name: "report",
  description: "Render a stored decision as summary.md and report.html, after the recompute check",
  options: {
    store: { type: "string", description: "The record store (default .ichnaea)" },
    run: { type: "string", description: "The run ID" },
    out: { type: "string", description: "Output directory (default <store>/runs/<run>/report)" },
  },
  async run(values, { out: print, err }) {
    const storePath = (values["store"] as string | undefined) ?? ".ichnaea";
    const runId = values["run"] as string | undefined;
    if (!runId) {
      err("report: --run is required");
      return 2;
    }
    const store = new FileStore(storePath);
    const stored = await store.read(runId);
    if (!stored.decision) {
      err(`report: run '${runId}' has no decision; run 'ichnaea decide' first`);
      return 2;
    }
    const check = await recompute({
      ...stored,
      decision: stored.decision,
      aa: await store.aaEvidence(stored.plan),
    });
    if (!check.matches) {
      err(
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
      err(`report: ${problems.join("; ")}`);
      return 1;
    }
    const out = (values["out"] as string | undefined) ?? join(storePath, "runs", runId, "report");
    await mkdir(out, { recursive: true });
    const files = [join(out, "summary.md"), join(out, "report.html")];
    await writeFile(files[0] as string, markdown);
    await writeFile(files[1] as string, html);
    print(`report: ${files.join(", ")}`);
    return 0;
  },
};
