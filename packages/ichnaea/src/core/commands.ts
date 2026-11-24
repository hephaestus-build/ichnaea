import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import * as z from "zod";

import type { RatingSet } from "../calibration/ratings-agreement.ts";
import { projectForEgress } from "../contracts/egress.ts";
import { Decision } from "../contracts/records/decision.ts";
import { canonicalize } from "../contracts/canonical.ts";
import { exitCode } from "../decide/ci-policy.ts";
import { decide } from "../decide/decide.ts";
import { renderReport, ReportError, verifiedReport } from "../report/report.ts";

import { resolutionLine } from "../plan/resolution.ts";

import { runDirectory } from "./store-path.ts";
import { FileStore } from "./store.ts";
import { CORE_VERSION } from "./version.ts";

/** A built-in command with options described by its help text. */
export interface CommandDefinition {
  readonly name: string;
  readonly description: string;
  readonly options: Readonly<
    Record<
      string,
      {
        readonly type: "string" | "boolean";
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
    json: { type: "boolean", description: "Print the class-none record as JSON" },
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
      ichnaea: CORE_VERSION,
    });
    await store.writeDecision(decision, stored.plan.suite);
    const verdictFile =
      (values["verdict-file"] as string | undefined) ??
      join(runDirectory(storePath, "runs", runId), "verdict.json");
    await writeFile(
      verdictFile,
      `${canonicalize({ run: decision.run, mode: decision.mode, verdict: decision.verdict, reason: decision.reason })}\n`,
    );
    if (values["json"] === true) {
      const projected = projectForEgress(Decision, decision, { purpose: "PU-1", maxClass: "none" });
      out(canonicalize(projected.value));
    } else {
      out(`${decision.verdict ?? "ESTIMATE-ONLY"}: ${decision.reason}`);
      for (const entry of decision.resolution ?? []) out(resolutionLine(entry));
    }
    return exitCode(decision, stored.plan.policy);
  },
};

const ratingSet = z.strictObject({
  metric: z.enum(["nominal", "ordinal", "interval"]),
  units: z
    .array(
      z.strictObject({
        item: z.string().min(1),
        stratum: z.string().min(1),
        raters: z.array(z.number().nullable()).min(2),
      }),
    )
    .min(1),
}) satisfies z.ZodType<RatingSet>;

async function readRatings(path: string): Promise<RatingSet> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("cannot read the ratings JSON file");
  }
  const parsed = ratingSet.safeParse(value);
  if (!parsed.success) throw new Error("the ratings file needs a metric and valid rating units");
  return parsed.data;
}

export const reportCommand: CommandDefinition = {
  name: "report",
  description: "Render a stored decision as summary.md and report.html, after the recompute check",
  options: {
    store: { type: "string", description: "The record store (default .ichnaea)" },
    run: { type: "string", description: "The run ID" },
    json: { type: "boolean", description: "Print the class-none record as JSON" },
    ratings: {
      type: "string",
      description: "Read a canonical JSON ratings set for the agreement section",
    },
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
    let markdown: string;
    let html: string;
    try {
      const ratings =
        typeof values["ratings"] === "string" ? await readRatings(values["ratings"]) : undefined;
      const result = verifiedReport(
        { ...stored, decision: stored.decision, aa: await store.aaEvidence(stored.plan) },
        { suite: stored.plan.suite, ...(ratings ? { ratings } : {}) },
        CORE_VERSION,
      );
      if (result.recalculation) await store.writeRecalculation(runId, result.recalculation);
      if (values["json"] === true) {
        print(canonicalize(result.view));
        return 0;
      }
      markdown = renderReport(result, "markdown");
      html = renderReport(result, "html");
    } catch (error) {
      if (!(error instanceof ReportError)) throw error;
      err(`report: ${error.message}`);
      return 1;
    }
    const out =
      (values["out"] as string | undefined) ??
      join(runDirectory(storePath, "runs", runId), "report");
    await mkdir(out, { recursive: true });
    const files = [join(out, "summary.md"), join(out, "report.html")];
    await writeFile(files[0] as string, markdown);
    await writeFile(files[1] as string, html);
    print(`report: ${files.join(", ")}`);
    return 0;
  },
};
