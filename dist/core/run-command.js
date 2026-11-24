import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as z from "zod";
import { canonicalize, digest } from "../contracts/canonical.js";
import { projectForEgress } from "../contracts/egress.js";
import { caseDigest } from "../contracts/identity.js";
import { RunId } from "../contracts/primitives.js";
import { CandidateHistory, RunPurpose } from "../contracts/records/run-registration.js";
import { Case } from "../contracts/records/case.js";
import { Run } from "../contracts/records/run.js";
import { Plan } from "../contracts/records/plan.js";
import { Trial } from "../contracts/records/trial.js";
import { sha256Hex } from "../contracts/sha256.js";
import { DEFAULT_TRIAL_DEADLINE_MS } from "../plan/analysis.js";
import { resolutionLine } from "../plan/resolution.js";
import { BlockRunner, InsufficientCallBudget } from "../run/blocks.js";
import { bindRunnerPlan, readLockedPlan } from "./analysis-plan.js";
import { hostAndStore } from "./cli-config.js";
import { CliError, CONFIG_OPTION, STORE_OPTION, text } from "./command-grammar.js";
import { decideRun, writeRunReport } from "./commands.js";
import { publishRecord } from "./publish-record.js";
import { recordRun } from "./record-run.js";
import { RecordsRepository, reserveCaseReads } from "./records-repository.js";
import { anchorAnalysisPlan, registrationLabel } from "./registration.js";
import { runWorkerBlock } from "./run-worker.js";
import { RunWork } from "./runner-work.js";
import { runDirectory } from "./store-path.js";
import { FileStore } from "./store.js";
import { CORE_VERSION } from "./version.js";
import { CommandWorker } from "./worker-transport.js";
const Snapshot = z.strictObject({
    plan: Plan,
    cases: z.array(Case),
    command: z.array(z.string()),
    records: z.string().optional(),
    purpose: RunPurpose,
    noise: z.boolean(),
    blocksOverride: z.int().positive().optional(),
});
const AttemptOutcome = z.strictObject({
    disposition: z.enum(["record", "retry", "timeout", "protocol", "budget-exceeded"]),
    calls: z.int().nonnegative(),
    trial: Trial.optional(),
});
async function replay(work) {
    const blocks = [];
    const trials = [];
    let failure;
    let open;
    let attempts = [];
    let timedOut = false;
    for (const entry of await work.entries()) {
        if (entry.kind === "block-start") {
            if (entry.plannedBlock === undefined || entry.draws === undefined)
                throw new Error("the work area predates case-pair draws");
            open = { block: entry.block, plannedBlock: entry.plannedBlock, draws: entry.draws };
            attempts = [];
            timedOut = false;
        }
        else if (entry.kind === "attempt-expired") {
            timedOut = true;
        }
        else if (entry.kind === "outcome") {
            const attempt = AttemptOutcome.parse(entry.result);
            attempts.push(attempt);
            if (attempt.disposition === "protocol" || attempt.disposition === "budget-exceeded")
                failure = attempt.disposition;
        }
        else if (entry.kind === "run-failed") {
            failure = entry.reason;
        }
        else if (entry.kind === "block-complete" || entry.kind === "block-abandoned") {
            if (!open)
                throw new Error("the journal settled a block without an order");
            const complete = entry.kind === "block-complete";
            if (!complete && timedOut)
                failure ??= "worker-unresponsive";
            blocks.push({
                ...open,
                status: complete ? "complete" : "abandoned",
                calls: attempts.reduce((sum, attempt) => sum + attempt.calls, 0),
            });
            if (complete)
                trials.push(...attempts.flatMap(({ trial }) => (trial ? [trial] : [])));
            open = undefined;
        }
    }
    return { blocks, trials, ...(failure ? { failure } : {}) };
}
async function earlier(store, repository, run, plan) {
    const scope = repository ? "records" : "store";
    const base = plan.arms.find(({ role }) => role === "base")?.identity;
    if (!base || !plan.suiteDigest || !plan.caseSetDigest)
        return { scope, candidates: [] };
    const key = { suite: plan.suiteDigest, caseSet: plan.caseSetDigest, base };
    if (repository) {
        const decisions = await repository.earlierCandidates(key);
        return CandidateHistory.parse({
            scope,
            candidates: decisions
                .filter((entry) => entry.run !== run)
                .map(({ run: earlierRun, candidate, verdict }) => ({
                run: earlierRun,
                candidate,
                verdict,
            })),
        });
    }
    const candidates = [];
    for (const entry of await store.index()) {
        if (entry.run === run || entry.suite !== plan.suite)
            continue;
        const prior = await store.read(entry.run);
        if (prior.plan.suiteDigest !== key.suite ||
            prior.plan.caseSetDigest !== key.caseSet ||
            prior.plan.arms.find(({ role }) => role === "base")?.identity !== base)
            continue;
        const candidate = prior.plan.arms.find(({ role }) => role === "candidate")?.identity;
        if (candidate)
            candidates.push({ run: RunId.parse(entry.run), candidate, verdict: entry.verdict });
    }
    return { scope, candidates };
}
export const runCommand = {
    name: "run",
    description: "Run a suite with a command worker, then decide and report",
    options: {
        config: CONFIG_OPTION,
        store: STORE_OPTION,
        plan: { type: "string", description: "Use this locked analysis plan" },
        anchor: { type: "string", description: "Anchor the plan to a Git remote ref" },
        noise: { type: "boolean", description: "Run the base configuration on both arms" },
        blocks: { type: "string", description: "Set the block horizon of a new local plan" },
        run: { type: "string", description: "Use this run ID" },
        resume: { type: "boolean", description: "Resume a run named by --run" },
        "no-decide": { type: "boolean", description: "Stop after sealing the run evidence" },
    },
    worker: true,
    async run(args, load, diagnostic) {
        const { host, store: root, config, directory } = await hostAndStore(args, load);
        if (!config.suite)
            throw new CliError("CONFIGURATION", "run: the configuration must define a suite");
        const noise = args.values["noise"] === true;
        const resume = args.values["resume"] === true;
        const run = text(args, "run") ?? randomUUID();
        if (resume && text(args, "run") === undefined)
            throw new CliError("USAGE", "--resume requires --run");
        const anchor = text(args, "anchor");
        const planPath = text(args, "plan");
        const count = text(args, "blocks");
        if (resume && (planPath !== undefined || anchor !== undefined || noise || count !== undefined))
            throw new CliError("USAGE", "--resume uses the original plan, anchor and horizon");
        if (anchor !== undefined && planPath === undefined)
            throw new CliError("USAGE", "--anchor requires --plan");
        if (count !== undefined &&
            (planPath !== undefined ||
                !/^[1-9][0-9]*$/.test(count) ||
                !Number.isSafeInteger(Number(count))))
            throw new CliError("USAGE", "--blocks requires a positive integer and a new local plan");
        const snapshotPath = join(runDirectory(root, "work", run), "prepared.json");
        const saved = resume
            ? Snapshot.parse(JSON.parse(await readFile(snapshotPath, "utf8")))
            : undefined;
        const records = config.records === undefined ? undefined : resolve(directory, config.records);
        if (saved &&
            (saved.records !== records || canonicalize(saved.command) !== canonicalize(args.worker)))
            throw new CliError("CONFIGURATION", "resume requires the original worker command and records checkout");
        const bytes = planPath === undefined ? undefined : await readFile(planPath);
        const blocksOverride = count === undefined ? saved?.blocksOverride : Number(count);
        const planned = await bindRunnerPlan({
            directory,
            definition: blocksOverride === undefined ? config.suite : { ...config.suite, blocks: blocksOverride },
        }, host, {
            createdAt: saved?.plan.createdAt ?? new Date().toISOString(),
            ichnaea: saved?.plan.ichnaea ?? CORE_VERSION,
            seed: saved?.plan.seed.value ?? randomBytes(8).readBigUInt64BE().toString(),
            trigger: "manual",
            varies: [],
        }, {
            noise: saved?.noise ?? noise,
            analysis: saved?.plan.analysis ??
                (planPath === undefined ? undefined : await readLockedPlan(planPath, bytes)),
        });
        const purpose = planned.plan.analysis?.purpose ?? (noise ? "development" : "regression");
        const snapshot = saved ??
            Snapshot.parse({
                ...planned,
                blocksOverride,
                command: [...args.worker],
                records,
                purpose,
                noise,
            });
        if (saved && digest(planned.plan) !== digest(saved.plan))
            throw new CliError("CONFIGURATION", "the bound plan changed since the run began");
        const { plan, cases } = snapshot;
        const analysis = plan.analysis;
        const base = plan.arms.find(({ role }) => role === "base")?.identity;
        const candidate = plan.arms.find(({ role }) => role === "candidate")?.identity;
        if (!analysis || !base)
            throw new Error("run needs a bound analysis plan");
        if (snapshot.noise && snapshot.purpose === "confirmation")
            throw new CliError("USAGE", "--noise cannot read confirmation cases");
        const anchored = anchor === undefined || planPath === undefined
            ? undefined
            : await anchorAnalysisPlan(directory, resolve(planPath), anchor, {
                run,
                base,
                candidate,
                seed: plan.seed,
                at: plan.createdAt,
            });
        if (anchored && (!bytes || anchored.planFileDigest !== `sha256:${sha256Hex(bytes)}`))
            throw new CliError("RECORDS", "the analysis plan changed while it was being anchored");
        if (anchor && !anchored)
            diagnostic("[ichnaea] The analysis plan could not be verified against the anchor ref.");
        const deadlineMs = analysis.deadlineMs ?? DEFAULT_TRIAL_DEADLINE_MS;
        const options = { capacity: 32, maxAttempts: 2, deadlineMs };
        const fresh = saved ? undefined : new BlockRunner(plan, options);
        const work = await RunWork.open(root, run, anchored, resume ? "resume" : "new");
        const stopped = new AbortController();
        const interrupt = () => stopped.abort(new Error("run interrupted"));
        process.once("SIGINT", interrupt);
        process.once("SIGTERM", interrupt);
        const store = new FileStore(root);
        let repository;
        try {
            const receipt = work.receipt();
            if (receipt &&
                (receipt.base !== base ||
                    receipt.candidate !== candidate ||
                    canonicalize(receipt.seed) !== canonicalize(plan.seed)))
                throw new Error("the bound plan differs from the journal receipt");
            const replayed = await replay(work);
            const runner = fresh ?? new BlockRunner(plan, options, replayed.blocks);
            if (saved)
                repository = records === undefined ? undefined : await RecordsRepository.open(records);
            else {
                repository = await reserveCaseReads(records, run, purpose, cases.map(caseDigest));
                await publishRecord(work.directory, "prepared.json", snapshot);
            }
            let failure = replayed.failure;
            let disrupted = false;
            while (!failure) {
                stopped.signal.throwIfAborted();
                let block;
                try {
                    block = runner.startBlock();
                }
                catch (error) {
                    if (!disrupted || !(error instanceof InsufficientCallBudget))
                        throw error;
                    failure = "worker-closed";
                    await work.fail(failure);
                    break;
                }
                if (!block)
                    break;
                const worker = await CommandWorker.start(args.worker, 3_000, (line) => diagnostic(`[worker] ${line}`), stopped.signal);
                const calls = plan.trials.filter((trial) => trial.block === block.plannedBlock).length *
                    (plan.budget.callsPerTrial ?? 1);
                let status;
                try {
                    await work.startBlock({ endpoint: "runner", cap: Number.MAX_SAFE_INTEGER, calls }, () => ({ plannedBlock: block.plannedBlock, draws: [...block.draws] }));
                    await work.handshake(worker.ready);
                    status = await runWorkerBlock({
                        work,
                        worker,
                        runner,
                        block,
                        prepared: snapshot,
                        run,
                        signal: stopped.signal,
                        deadlineMs,
                    });
                }
                finally {
                    await worker.close();
                }
                if (status === "complete") {
                    runner.finishBlock();
                    await work.completeBlock();
                    disrupted = false;
                }
                else if (status === "worker-closed") {
                    runner.abandonBlock("transport");
                    await work.abandonBlock();
                    disrupted = true;
                }
                else {
                    await work.abandonBlock(status);
                    failure = status;
                }
            }
            const recorded = await replay(work);
            const registration = registrationLabel("runner", candidate !== undefined && !snapshot.noise, work.receipt());
            const history = await earlier(store, repository, run, plan);
            await recordRun({
                host,
                store: { createRun: (sealed) => work.seal(sealed) },
                id: run,
                plan,
                cases,
                result: { trials: recorded.trials, values: [] },
                execution: {
                    source: "runner",
                    registration,
                    history,
                    ...(failure ? { failure } : {}),
                    blocks: recorded.blocks.map(({ calls: _calls, ...block }) => block),
                },
                startedAt: plan.createdAt,
                completedAt: new Date().toISOString(),
            });
        }
        finally {
            process.removeListener("SIGINT", interrupt);
            process.removeListener("SIGTERM", interrupt);
            await work.close();
        }
        const planLine = [
            `plan: ${cases.length} ${cases.length === 1 ? "case" : "cases"}, ${analysis.blocks} blocks, ${plan.budget.worstCaseCalls} calls`,
            ...(analysis.resolution ?? []).map((entry) => resolutionLine(entry)),
        ].join(" • ");
        if (args.values["no-decide"] === true) {
            const stored = await store.read(run);
            return {
                code: 0,
                text: [planLine, `run: ${run}`],
                json: projectForEgress(Run, stored.run, { maxClass: "none", purpose: "PU-1" }).value,
            };
        }
        const result = await decideRun(store, run);
        const files = await writeRunReport(store, run);
        const stored = await store.read(run);
        if (!snapshot.noise &&
            candidate &&
            stored.decision &&
            repository &&
            plan.suiteDigest &&
            plan.caseSetDigest)
            await repository.appendDecision({
                suite: plan.suiteDigest,
                caseSet: plan.caseSetDigest,
                base,
                candidate,
                run,
                decidedAt: stored.decision.decidedAt,
                verdict: stored.decision.verdict,
            });
        return {
            ...result,
            text: snapshot.noise
                ? [...result.text, ...files.text, planLine]
                : [planLine, ...result.text, ...files.text],
        };
    },
};
//# sourceMappingURL=run-command.js.map