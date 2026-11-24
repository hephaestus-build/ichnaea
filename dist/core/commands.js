import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as z from "zod";
import { canonicalize } from "../contracts/canonical.js";
import { projectForEgress } from "../contracts/egress.js";
import { ReportView } from "../contracts/records/cli.js";
import { Decision } from "../contracts/records/decision.js";
import { exitCode } from "../decide/ci-policy.js";
import { decide } from "../decide/decide.js";
import { resolutionLine } from "../plan/resolution.js";
import { renderReport, ReportError, verifiedReport } from "../report/report.js";
import { storeFor } from "./cli-config.js";
import { CliError, CONFIG_OPTION, required, STORE_OPTION, text, } from "./command-grammar.js";
import { runDirectory } from "./store-path.js";
import { FileStore } from "./store.js";
import { CORE_VERSION } from "./version.js";
const RUN_OPTION = { type: "string", description: "The run ID", required: true };
async function readRun(store, run) {
    const directory = runDirectory(store.root, "runs", run);
    try {
        return await store.read(run);
    }
    catch (cause) {
        throw new CliError("RECORDS", cause instanceof Error ? cause.message : String(cause), {
            cause,
            publicMessage: `Could not read the stored run in ${directory}.`,
        });
    }
}
export const decideCommand = {
    name: "decide",
    description: "Decide a stored run and write its verdict",
    options: {
        config: CONFIG_OPTION,
        store: STORE_OPTION,
        run: RUN_OPTION,
        "verdict-file": {
            type: "string",
            description: "Where to write the machine-readable verdict (default <store>/runs/<run>/verdict.json)",
        },
        now: {
            type: "string",
            description: "The decision time (default: now). Fix it to reproduce a decision byte for byte.",
        },
    },
    async run(args, load) {
        const store = new FileStore(await storeFor(args, load));
        const run = required(args, "run");
        return decideRun(store, run, text(args, "verdict-file"), text(args, "now"));
    },
};
export async function decideRun(store, run, output, now) {
    const stored = await readRun(store, run);
    let decision = stored.decision;
    if (decision === undefined) {
        decision = await decide({
            plan: stored.plan,
            run: stored.run,
            trials: stored.trials,
            values: stored.values,
            gates: stored.gates,
            decidedAt: now ?? new Date().toISOString(),
            ichnaea: CORE_VERSION,
        });
        await store.writeDecision(decision, stored.plan.suite);
    }
    const verdictFile = output ?? join(runDirectory(store.root, "runs", run), "verdict.json");
    const { mode, verdict, reason, reasonCode, cause, withinRunDrop, registration } = decision;
    await writeFile(verdictFile, `${canonicalize({
        run: decision.run,
        mode,
        verdict,
        reason,
        registration,
        ...(reasonCode === undefined ? {} : { reasonCode }),
        ...(cause === undefined ? {} : { cause }),
        ...(withinRunDrop === undefined ? {} : { withinRunDrop }),
    })}\n`);
    return {
        code: exitCode(decision, stored.plan.policy) === 1 ? 1 : 0,
        text: [
            `${decision.verdict ?? "ESTIMATE-ONLY"}: ${decision.reason}${decision.registration ? ` [${decision.registration}]` : ""}`,
            ...(decision.registration === "unregistered"
                ? ["The analysis was not anchored before this run."]
                : []),
            ...(decision.resolution ?? []).map((entry) => resolutionLine(entry)),
        ],
        json: projectForEgress(Decision, decision, { maxClass: "none", purpose: "PU-1" }).value,
    };
}
const ratingSet = z.strictObject({
    metric: z.enum(["nominal", "ordinal", "interval"]),
    units: z
        .array(z.strictObject({
        item: z.string().min(1),
        stratum: z.string().min(1),
        raters: z.array(z.number().nullable()).min(2),
    }))
        .min(1),
});
async function readRatings(path) {
    let value;
    try {
        value = JSON.parse(await readFile(path, "utf8"));
    }
    catch (cause) {
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
export const reportCommand = {
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
        const ratingsPath = text(args, "ratings");
        return writeRunReport(store, run, text(args, "format"), text(args, "out"), args.values["json"] === true, ratingsPath);
    },
};
export async function writeRunReport(store, run, format, output, jsonOnly = false, ratingsPath) {
    const stored = await readRun(store, run);
    if (!stored.decision) {
        const file = join(runDirectory(store.root, "runs", run), "decision.json");
        const message = `report: no decision at ${file}; run 'ichnaea decide' first`;
        throw new CliError("RECORDS", message, { publicMessage: message });
    }
    const ratings = ratingsPath === undefined ? undefined : await readRatings(ratingsPath);
    let verified;
    try {
        verified = verifiedReport({ ...stored, decision: stored.decision, aa: await store.aaEvidence(stored.plan) }, { suite: stored.plan.suite, ...(ratings ? { ratings } : {}) }, CORE_VERSION);
    }
    catch (cause) {
        if (!(cause instanceof ReportError))
            throw cause;
        throw new CliError("RECOMPUTE_MISMATCH", `report: ${cause.message}`, { cause });
    }
    if (verified.recalculation)
        await store.writeRecalculation(run, verified.recalculation);
    const { view } = verified;
    const json = ReportView.parse({
        schema: "ichnaea.reportView/1",
        ...view,
        lineage: view.lineage.map(([label, value]) => ({ label, value })),
    });
    if (format === undefined && jsonOnly)
        return { code: 0, text: [], json };
    const directory = output ?? join(runDirectory(store.root, "runs", run), "report");
    const files = new Map();
    if (format === "json")
        files.set(join(directory, "report.json"), `${JSON.stringify(json, null, 2)}\n`);
    if (format === "md" || format === undefined)
        files.set(join(directory, "summary.md"), renderReport(verified, "markdown"));
    if (format === "html" || format === undefined)
        files.set(join(directory, "report.html"), renderReport(verified, "html"));
    await mkdir(directory, { recursive: true });
    for (const [file, contents] of files)
        await writeFile(file, contents);
    return { code: 0, text: [`report: ${[...files.keys()].join(", ")}`], json };
}
//# sourceMappingURL=commands.js.map