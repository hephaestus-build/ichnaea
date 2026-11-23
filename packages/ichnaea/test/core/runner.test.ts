import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { digest } from "../../src/contracts/canonical.ts";
import { Digest } from "../../src/contracts/primitives.ts";

import {
  createHost,
  FileStore,
  main,
  runCommandWorker,
  type RunWorkerInput,
} from "../../src/core/index.ts";
import { decide } from "../../src/decide/index.ts";
import { card, scenario } from "../decide/support/scenario.ts";

async function fixture(mode: string): Promise<RunWorkerInput & { log: string }> {
  const store = await mkdtemp(join(tmpdir(), "ichnaea-worker-"));
  const log = join(store, "worker.jsonl");
  const { plan, caseSet, cases } = await scenario({
    cases: 3,
    replicates: 1,
    base: () => 1,
    candidate: () => 1,
    opaque: true,
    schedule: { concurrency: 2, endpoint: "fixture" },
    baseConfig: (c) => ({
      ...c,
      factors: { "code.commit": { part: "code", status: "pinned", value: "a".repeat(40) } },
    }),
    candidateConfig: (c) => ({
      ...c,
      factors: { "code.commit": { part: "code", status: "pinned", value: "b".repeat(40) } },
    }),
  });
  const definition = card("app/correct");
  const host = createHost(
    {
      plugins: [
        {
          id: "app",
          version: "1.0.0",
          stability: "stable",
          measures: [{ ...definition, card: { ...definition.card, id: "app/correct" as const } }],
        },
      ],
    },
    { core: "0.0.0", contracts: "0.0.0" },
  );
  return {
    host,
    store,
    run: "worker-run",
    plan,
    caseSet,
    cases,
    log,
    monthlyCap: 100,
    command: [
      process.execPath,
      join(import.meta.dirname, "fixtures", "command-worker.mjs"),
      mode,
      log,
    ],
    deadline: "PT1S",
    ichnaea: "0.0.0",
  };
}

async function requests(log: string): Promise<{ id: string; attempt: number }[]> {
  const lines = (await readFile(log, "utf8")).trim().split("\n");
  return lines
    .map(
      (line) =>
        JSON.parse(line) as {
          kind: string;
          trial?: { id: string; attempt: number };
        },
    )
    .flatMap((line) => (line.kind === "ichnaea.trialRequest/1" && line.trial ? [line.trial] : []));
}

describe("command worker conformance", () => {
  it("runs the exact locked order and stores the normalized and raw records", async () => {
    const input = await fixture("order");
    expect(await runCommandWorker(input)).toEqual({ trials: 6, values: 0, interrupted: false });
    expect((await requests(input.log)).map((trial) => trial.id)).toEqual(
      input.plan.trials.map((t) => t.id),
    );
    const run = await new FileStore(input.store).read(input.run);
    expect(run.trials.every((t) => t.outcome === "completed")).toBe(true);
    expect(run.workerResults?.map((result) => result.trial.id)).toEqual(
      input.plan.trials.map((t) => t.id),
    );
  });

  it("refuses an out-of-order result and names the trial", async () => {
    const input = await fixture("reverse");
    const result = await runCommandWorker(input);
    expect(result.workerError).toContain(
      `out-of-order result for trial '${input.plan.trials[1]?.id}'`,
    );
    const run = await new FileStore(input.store).read(input.run);
    expect(decide({ ...run, decidedAt: new Date().toISOString(), ichnaea: "0.0.0" }).verdict).toBe(
      "INVALID",
    );
  });

  it("retries an infrastructure failure as the next attempt and never retries a system failure", async () => {
    const input = await fixture("retry");
    await runCommandWorker(input);
    const trace = await requests(input.log);
    expect(trace.slice(0, 3).map(({ id, attempt }) => [id, attempt])).toEqual([
      [input.plan.trials[0]?.id, 1],
      [input.plan.trials[0]?.id, 2],
      [input.plan.trials[1]?.id, 1],
    ]);
    expect(trace.filter((t) => t.id === input.plan.trials[1]?.id)).toHaveLength(1);
    const run = await new FileStore(input.store).read(input.run);
    expect(run.trials[0]).toMatchObject({
      outcome: "completed",
      attempts: [{ attempt: 1, failure: { class: "infrastructure", kind: "temporary" }, calls: 0 }],
    });
    expect(run.trials[1]).toMatchObject({ outcome: "system_failure", error: { kind: "broken" } });
    expect(run.workerResults).toHaveLength(7);
  });

  it("cancels a deadline without retrying, then continues with the remaining trials", async () => {
    const input = await fixture("deadline");
    await runCommandWorker({ ...input, deadline: "PT0.15S" });
    const trace = await readFile(input.log, "utf8");
    expect(trace).toContain(
      `"kind":"ichnaea.cancel/1","trial":{"id":"${input.plan.trials[0]?.id}"`,
    );
    const run = await new FileStore(input.store).read(input.run);
    expect(run.trials[0]).toMatchObject({ outcome: "system_failure", error: { kind: "timeout" } });
    expect(run.trials.slice(1).every((trial) => trial.outcome === "completed")).toBe(true);
    expect(
      (await requests(input.log)).filter((t) => t.id === input.plan.trials[0]?.id),
    ).toHaveLength(1);
  });

  it("lets a buffered second result arrive after its predecessor times out", async () => {
    const input = await fixture("ordered-deadline");
    const outcome = await runCommandWorker({ ...input, deadline: "PT0.15S" });
    expect(outcome.workerError).toBeUndefined();
    const run = await new FileStore(input.store).read(input.run);
    expect(run.trials[0]).toMatchObject({ outcome: "system_failure", error: { kind: "timeout" } });
    expect(run.trials[1]).toMatchObject({ id: input.plan.trials[1]?.id, outcome: "completed" });
    const trace = await readFile(input.log, "utf8");
    expect(trace).toContain(
      `"kind":"ichnaea.cancel/1","trial":{"id":"${input.plan.trials[0]?.id}"`,
    );
    expect(trace).not.toContain(
      `"kind":"ichnaea.cancel/1","trial":{"id":"${input.plan.trials[1]?.id}"`,
    );
  });

  it("excludes throttling reported by a heartbeat from the deadline", async () => {
    const input = await fixture("throttled");
    const outcome = await runCommandWorker({ ...input, deadline: "PT0.8S" });
    expect(outcome.workerError).toBeUndefined();
    const run = await new FileStore(input.store).read(input.run);
    expect(run.trials[0]).toMatchObject({ outcome: "completed" });
    expect(run.workerResults?.[0]?.usage.throttled?.ms).toBeGreaterThanOrEqual(800);
    expect(await readFile(input.log, "utf8")).not.toContain("ichnaea.cancel/1");
  });

  it("records an unexpected exit and continues on a new worker", async () => {
    const input = await fixture("exit");
    const outcome = await runCommandWorker(input);
    expect(outcome.workerError).toBeUndefined();
    const run = await new FileStore(input.store).read(input.run);
    expect(run.trials[0]).toMatchObject({
      outcome: "infrastructure_failure",
      usage: { calls: 1 },
      error: { kind: "worker-exited" },
    });
    expect(run.trials.slice(1).every((trial) => trial.outcome === "completed")).toBe(true);
    expect(await requests(input.log)).toHaveLength(6);
  });

  it("stores an early worker exit as a transport failure", async () => {
    const input = await fixture("exit-before-ready");
    const outcome = await runCommandWorker(input);
    expect(outcome).toMatchObject({ trials: 0, workerError: "worker closed stdout" });
    const stored = await new FileStore(input.store).read(input.run);
    expect(stored.run.workerError).toBe("worker closed stdout");
  });

  it("books against the monthly cap before starting the command", async () => {
    const input = await fixture("order");
    await expect(runCommandWorker({ ...input, monthlyCap: 5 })).rejects.toThrow("plans 6 calls");
    await expect(readFile(input.log, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await new FileStore(input.store).runs()).toEqual([]);
  });

  it("cancels active work on an operator interrupt and leaves later trials not run", async () => {
    const input = await fixture("deadline");
    const controller = new AbortController();
    const run = runCommandWorker({ ...input, signal: controller.signal, deadline: "PT5S" });
    await expect.poll(async () => (await requests(input.log).catch(() => [])).length).toBe(1);
    controller.abort();
    await expect(run).resolves.toMatchObject({ interrupted: true, trials: 1 });
    const stored = await new FileStore(input.store).read(input.run);
    expect(stored.trials[0]).toMatchObject({
      outcome: "not_run",
      error: { kind: "operator-cancelled" },
    });
    expect(stored.run.ledger.slice(1).every((trial) => trial.state === "planned")).toBe(true);
  });

  it("runs through the CLI using the saved plan and cases", async () => {
    const input = await fixture("order");
    const plan = join(input.store, "plan.json");
    const caseSet = join(input.store, "case-set.json");
    const cases = join(input.store, "cases.jsonl");
    const config = join(input.store, "config.ts");
    await Promise.all([
      writeFile(plan, JSON.stringify(input.plan)),
      writeFile(caseSet, JSON.stringify(input.caseSet)),
      writeFile(cases, input.cases.map((item) => JSON.stringify(item)).join("\n")),
      writeFile(config, ""),
    ]);
    const out: string[] = [];
    expect(
      await main(
        [
          "run",
          "--config",
          config,
          "--run",
          input.run,
          "--store",
          input.store,
          "--plan",
          plan,
          "--case-set",
          caseSet,
          "--cases",
          cases,
          "--worker",
          input.command[0],
          ...input.command.slice(1).flatMap((arg) => ["--worker-arg", arg]),
          "--deadline",
          "PT1S",
          "--monthly-cap",
          "100",
        ],
        (line) => {
          out.push(line);
        },
        async () => ({ default: { plugins: input.host.plugins } }),
      ),
      out.join("\n"),
    ).toBe(0);
    expect((await new FileStore(input.store).read(input.run)).workerResults).toHaveLength(6);
  });

  it("keeps accepted worker results when a local scorer fails", async () => {
    const input = await fixture("order");
    const definition = card("app/correct");
    const scoped = {
      ...definition.card,
      id: "app/correct" as const,
      computedBy: "ichnaea" as const,
    };
    const host = createHost(
      {
        plugins: [
          {
            id: "app",
            version: "1.0.0",
            stability: "stable",
            measures: [
              {
                card: scoped,
                score: () => {
                  throw new Error("scorer failed");
                },
              },
            ],
          },
        ],
      },
      { core: "0.0.0", contracts: "0.0.0" },
    );
    const plan = {
      ...input.plan,
      measures: input.plan.measures.map((measure) => ({
        ...measure,
        digest: Digest.parse(digest(scoped)),
      })),
    };
    await expect(runCommandWorker({ ...input, host, plan })).rejects.toThrow("scorer failed");
    const recorded = await readFile(
      join(input.store, "worker", input.run, ".received.jsonl"),
      "utf8",
    );
    expect(recorded.trim().split("\n")).toHaveLength(6);
  });

  it("records a configuration mismatch without scoring it", async () => {
    const input = await fixture("mismatch");
    const result = await runCommandWorker(input);
    expect(result.workerError).toBeUndefined();
    const run = await new FileStore(input.store).read(input.run);
    expect(run.trials.every((trial) => trial.outcome === "invalid_configuration")).toBe(true);
    expect(run.values).toEqual([]);
  });
});
