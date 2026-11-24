import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import * as z from "zod";

import type { RatingSet } from "../calibration/ratings-agreement.ts";
import { canonicalize } from "../contracts/canonical.ts";
import { projectForEgress } from "../contracts/egress.ts";
import { ReportView } from "../contracts/records/cli.ts";
import { Decision } from "../contracts/records/decision.ts";
import { exitCode } from "../decide/ci-policy.ts";
import { decide } from "../decide/decide.ts";
import { resolutionLine } from "../plan/resolution.ts";
import { renderReport, ReportError, verifiedReport } from "../report/report.ts";

import { storeFor } from "./cli-config.ts";
import {
  CliError,
  type Command,
  CONFIG_OPTION,
  required,
  STORE_OPTION,
  text,
} from "./command-grammar.ts";
import { runDirectory } from "./store-path.ts";
import { FileStore, type StoredRun } from "./store.ts";
import { CORE_VERSION } from "./version.ts";

const RUN_OPTION = { type: "string", description: "The run ID", required: true } as const;

async function readRun(store: FileStore, run: string): Promise<StoredRun> {
  const directory = runDirectory(store.root, "runs", run);
  try {
    return await store.read(run);
  } catch (cause) {
    throw new CliError("RECORDS", cause instanceof Error ? cause.message : String(cause), {
      cause,
      publicMessage: `Could not read the stored run in ${directory}.`,
    });
  }
}

export const decideCommand: Command = {
  name: "decide",
  description: "Decide a stored run and write its verdict",
  options: {
    config: CONFIG_OPTION,
    store: STORE_OPTION,
    run: RUN_OPTION,
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
  async run(args, load) {
    const store = new FileStore(await storeFor(args, load));
    const run = required(args, "run");
    const stored = await readRun(store, run);
    let decision = stored.decision;
    if (decision === undefined) {
      decision = await decide({
        plan: stored.plan,
        run: stored.run,
        trials: stored.trials,
        values: stored.values,
        gates: stored.gates,
        aa: await store.aaEvidence(stored.plan),
        decidedAt: text(args, "now") ?? new Date().toISOString(),
        ichnaea: CORE_VERSION,
      });
      await store.writeDecision(decision, stored.plan.suite);
    }
    const verdictFile =
      text(args, "verdict-file") ?? join(runDirectory(store.root, "runs", run), "verdict.json");
    await writeFile(
      verdictFile,
      `${canonicalize({ run: decision.run, mode: decision.mode, verdict: decision.verdict, reason: decision.reason })}\n`,
    );
    return {
      code: exitCode(decision, stored.plan.policy) === 1 ? 1 : 0,
      text: [
        `${decision.verdict ?? "ESTIMATE-ONLY"}: ${decision.reason}`,
        ...(decision.resolution ?? []).map((entry) => resolutionLine(entry)),
      ],
      json: projectForEgress(Decision, decision, { maxClass: "none", purpose: "PU-1" }).value,
    };
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
  } catch (cause) {
    const message = "Cannot read the ratings JSON file.";
    throw new CliError("RECORDS", message, { cause, publicMessage: message });
  }
  const parsed = ratingSet.safeParse(value);
  if (!parsed.success) {
    const message = "The ratings file needs a metric and valid rating units.";
    throw new CliError("RECORDS", message, { publicMessage: message });
  }
  return parsed.data;
}

export const reportCommand: Command = {
  name: "report",
  description: "Recompute and report a stored decision",
  options: {
    config: CONFIG_OPTION,
    store: STORE_OPTION,
    run: RUN_OPTION,
    ratings: {
      type: "string",
      description: "Read a canonical JSON ratings set for the agreement section",
    },
    out: { type: "string", description: "Output directory (default <store>/runs/<run>/report)" },
    format: {
      type: "string",
      choices: ["md", "html", "json"],
      description: "Report file format (default: md and html)",
    },
  },
  async run(args, load) {
    const store = new FileStore(await storeFor(args, load));
    const run = required(args, "run");
    const stored = await readRun(store, run);
    if (!stored.decision) {
      const file = join(runDirectory(store.root, "runs", run), "decision.json");
      const message = `report: no decision at ${file}; run 'ichnaea decide' first`;
      throw new CliError("RECORDS", message, { publicMessage: message });
    }
    const ratingsPath = text(args, "ratings");
    const ratings = ratingsPath === undefined ? undefined : await readRatings(ratingsPath);
    let verified: ReturnType<typeof verifiedReport>;
    try {
      verified = verifiedReport(
        { ...stored, decision: stored.decision, aa: await store.aaEvidence(stored.plan) },
        { suite: stored.plan.suite, ...(ratings ? { ratings } : {}) },
        CORE_VERSION,
      );
    } catch (cause) {
      if (!(cause instanceof ReportError)) throw cause;
      throw new CliError("RECOMPUTE_MISMATCH", `report: ${cause.message}`, { cause });
    }
    if (verified.recalculation) await store.writeRecalculation(run, verified.recalculation);
    const { view } = verified;
    const json = ReportView.parse({
      schema: "ichnaea.reportView/1",
      ...view,
      lineage: view.lineage.map(([label, value]) => ({ label, value })),
    });
    const format = text(args, "format");
    if (format === undefined && args.values["json"] === true) return { code: 0, text: [], json };
    const directory = text(args, "out") ?? join(runDirectory(store.root, "runs", run), "report");
    const files = new Map<string, string>();
    if (format === "json")
      files.set(join(directory, "report.json"), `${JSON.stringify(json, null, 2)}\n`);
    if (format === "md" || format === undefined)
      files.set(join(directory, "summary.md"), renderReport(verified, "markdown"));
    if (format === "html" || format === undefined)
      files.set(join(directory, "report.html"), renderReport(verified, "html"));
    await mkdir(directory, { recursive: true });
    for (const [file, contents] of files) await writeFile(file, contents);
    return { code: 0, text: [`report: ${[...files.keys()].join(", ")}`], json };
  },
};
