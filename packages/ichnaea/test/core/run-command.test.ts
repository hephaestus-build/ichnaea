import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { main } from "../../src/cli.ts";
import { pairFirst } from "../../src/contracts/block-order.ts";
import { digest } from "../../src/contracts/canonical.ts";
import { RecordsRepository } from "../../src/core/records-repository.ts";
import { FileStore } from "../../src/core/store.ts";

async function suite(directory: string, records?: string, confirmation = false): Promise<string> {
  const config = join(directory, "ichnaea.config.ts");
  await writeFile(
    join(directory, "cases.jsonl"),
    '{"id":"capital-fr","input":{"q":"Capital of France?"}}\n',
  );
  await writeFile(
    config,
    `
      export default {
        plugins: [],
        records: ${JSON.stringify(records)},
        suite: {
          purpose: ${JSON.stringify(confirmation ? "confirmation" : undefined)},
          id: "answers", cases: "cases.jsonl", blocks: 2, maxCalls: 4,
          caseDefaults: {
            unit: "turn", dataClass: "none", pool: "development",
            provenance: { source: "authored", selection: "curated", created: "2026-11-24",
              exposure: "private", licence: "CC0-1.0" },
          },
          arms: { base: { model: "first" }, candidate: { model: "second" } },
          objective: "Compare answers", construct: "Accuracy", decision: "Release",
          scope: "Short answers", nonCoverage: ["Long answers"],
        },
      };
    `,
  );
  return config;
}

const worker = [process.execPath, join(import.meta.dirname, "fixtures", "serve-worker.ts")];

it("runs a local suite, seals the pair order and writes an unregistered verdict and report", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ichnaea-run-"));
  try {
    const config = await suite(directory);
    const store = join(directory, "store");
    const out: string[] = [];
    const errors: string[] = [];
    const code = await main(
      [
        "run",
        "--config",
        config,
        "--store",
        store,
        "--run",
        "local",
        "--",
        process.execPath,
        join(import.meta.dirname, "fixtures", "serve-worker.ts"),
      ],
      (line) => out.push(line),
      undefined,
      (line) => errors.push(line),
    );
    expect(code, [...out, ...errors].join("\n")).toBe(0);
    expect(out[0]).toMatch(/^plan: 1 case, 2 blocks, 4 calls/);
    expect(out.some((line) => line.includes("unregistered"))).toBe(true);
    const stored = await new FileStore(store).read("local");
    expect(stored.trials).toHaveLength(4);
    expect(stored.trials.map((trial) => trial.analysisPlan)).toEqual(
      Array(4).fill(digest(stored.plan.analysis)),
    );
    expect(stored.run.execution?.blocks).toHaveLength(2);
    for (const block of stored.run.execution?.blocks ?? []) {
      const trials = stored.trials.filter((trial) => trial.block === block.block);
      expect(trials).toHaveLength(2);
      expect(block.draws).toEqual([
        {
          case: "capital-fr",
          replicate: block.plannedBlock,
          first: pairFirst(stored.plan.seed, block.block, {
            case: "capital-fr",
            replicate: block.plannedBlock,
          }),
        },
      ]);
      expect(trials.map(({ first }) => first)).toEqual([
        block.draws?.[0]?.first,
        block.draws?.[0]?.first,
      ]);
    }
    expect(
      JSON.parse(await readFile(join(store, "runs", "local", "verdict.json"), "utf8")),
    ).toMatchObject({ registration: "unregistered" });
    await expect(
      readFile(join(store, "runs", "local", "report", "summary.md"), "utf8"),
    ).resolves.toContain("unregistered");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      ...args,
    ],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

it("anchors exact plan bytes, records a decision and refuses a spent confirmation case", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ichnaea-run-confirmation-"));
  try {
    const records = join(directory, "records");
    git(directory, "init", "--bare", "remote");
    git(directory, "init", "-b", "main");
    git(directory, "init", "-b", "main", records);
    const config = await suite(directory, records, true);

    const store = join(directory, "store");
    const plan = join(directory, "plan.json");
    const errors: string[] = [];
    const docs: string[] = [];
    async function cli(command: string, ...args: string[]): Promise<number> {
      docs.length = 0;
      errors.length = 0;
      return main(
        [
          command,
          "--config",
          config,
          "--store",
          store,
          ...(command === "plan" ? [] : ["--json"]),
          ...args,
        ],
        (line) => docs.push(line),
        undefined,
        (line) => errors.push(line),
      );
    }
    expect(await cli("plan"), errors.join("\n")).toBe(0);
    git(directory, "add", "plan.json", "ichnaea.lock");
    git(directory, "commit", "-m", "Lock the analysis");
    const commit = git(directory, "rev-parse", "HEAD");
    git(directory, "remote", "add", "origin", join(directory, "remote"));
    git(directory, "push", "origin", "main");
    const flags = ["--plan", plan, "--anchor", "origin/main"];
    expect(await cli("run", "--run", "first", ...flags, "--", ...worker), errors.join("\n")).toBe(
      0,
    );
    expect(docs).toHaveLength(1);
    expect(JSON.parse(docs[0] ?? "")).toMatchObject({ registration: "registered" });
    const opened = JSON.parse(
      await readFile(join(store, "runs", "first", "journal", "0.json"), "utf8"),
    );
    expect(opened).toMatchObject({
      kind: "receipt",
      receipt: { planCommit: commit, remoteSha: commit },
    });

    git(records, "add", ".");
    git(records, "commit", "-m", "Record the confirmation");
    git(directory, "clone", records, "fresh-records");
    const fresh = join(directory, "fresh-records");
    const reopened = await RecordsRepository.open(fresh);
    const bound = (await new FileStore(store).read("first")).plan;
    expect(
      await reopened.earlierCandidates({
        suite: bound.suiteDigest ?? "",
        caseSet: bound.caseSetDigest ?? "",
        base: bound.arms[0]?.identity ?? "",
      }),
    ).toMatchObject([{ run: "first" }]);
    await expect(
      reopened.recordReads(
        "another",
        "confirmation",
        bound.analysis?.cases.map((entry) => entry.digest) ?? [],
      ),
    ).rejects.toThrow(/already read/);
    expect(await cli("run", "--run", "again", ...flags, "--", ...worker)).toBe(2);
    await expect(
      readFile(join(store, "work", "again", "journal", "1.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("seals a protocol failure as INVALID without admitting the uncorrelated result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ichnaea-run-malformed-"));
  try {
    const config = await suite(directory);
    const store = join(directory, "store");
    const docs: string[] = [];
    expect(
      await main(
        [
          "run",
          "--config",
          config,
          "--store",
          store,
          "--run",
          "malformed",
          "--json",
          "--",
          process.execPath,
          join(import.meta.dirname, "fixtures/worker-check.ts"),
          "unknown",
        ],
        (line) => docs.push(line),
        undefined,
        () => {},
      ),
    ).toBe(1);
    expect(docs).toHaveLength(1);
    expect(JSON.parse(docs[0] ?? "")).toMatchObject({ verdict: "INVALID" });
    const saved = await new FileStore(store).read("malformed");
    expect(saved.trials).toHaveLength(0);
    expect(saved.run.execution).toMatchObject({
      failure: "protocol",
      blocks: [{ status: "abandoned" }],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
