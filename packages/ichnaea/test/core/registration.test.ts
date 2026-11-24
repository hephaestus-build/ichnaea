import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import fc from "fast-check";
import { afterEach, beforeEach, expect, it } from "vitest";

import { anchorAnalysisPlan, registrationLabel } from "../../src/core/registration.ts";
import { RecordsRepository, reserveCaseReads } from "../../src/core/records-repository.ts";

import { RunWork } from "../../src/core/runner-work.ts";

const digest = (key: string): string => `sha256:${key.repeat(64)}`;
const at = "2026-11-24T00:00:00Z";
const binding = {
  run: "candidate-2",
  base: digest("1"),
  candidate: digest("2"),
  seed: { algorithm: "mt19937", value: "18446744073709551615" },
  at,
};
let scratch: string;

const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
    "git",
    [
      "-C",
      cwd,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "-c",
      "commit.gpgSign=false",
      ...args,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "ichnaea-registration-"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function checkout(name: string): Promise<{ bare: string; checkout: string }> {
  const bare = join(scratch, `${name}.git`);
  git(scratch, "init", "--bare", "--initial-branch=main", bare);
  git(scratch, "clone", pathToFileURL(bare).href, name);
  return { bare, checkout: join(scratch, name) };
}

function commit(working: string): string {
  git(working, "add", ".");
  git(working, "commit", "-m", "fixture");
  return git(working, "rev-parse", "HEAD");
}

it("registers an unchanged anchored analysis plan and leaves local changes unregistered", async () => {
  const { checkout: working, bare } = await checkout("suite");
  const path = "analysis-plan.json";
  git(working, "commit", "--allow-empty", "-m", "initial");
  const write = (blocks: number): Promise<void> =>
    writeFile(join(working, path), `${JSON.stringify({ blocks })}\n`);
  await write(6);
  const commitSha = commit(working);
  git(working, "push", "origin", "main");
  const receipt = await anchorAnalysisPlan(working, path, "origin/main", binding);
  expect(receipt).toEqual({
    planPath: path,
    planCommit: commitSha,
    planFileDigest: `sha256:${createHash("sha256").update('{"blocks":6}\n').digest("hex")}`,
    remote: "origin",
    ref: "refs/heads/main",
    remoteSha: commitSha,
    ...binding,
  });
  const store = join(scratch, "store");
  const work = await RunWork.open(store, binding.run, receipt);
  try {
    expect((await work.entries())[0]).toEqual({ kind: "receipt", receipt });
    expect(registrationLabel("runner", true, work.receipt())).toBe("registered");
  } finally {
    await work.close();
  }
  const alias = join(scratch, "suite-alias");
  await symlink(working, alias, "dir");
  expect(await anchorAnalysisPlan(alias, path, "origin/main", binding)).toEqual(receipt);
  if (!receipt) throw new Error("expected a registration receipt");
  await expect(
    RunWork.open(store, binding.run, { ...receipt, candidate: digest("3") }),
  ).rejects.toThrow(/receipt changed/);

  await write(8);
  expect(await anchorAnalysisPlan(working, path, "origin/main", binding)).toBeUndefined();
  commit(working);
  const unpushed = await anchorAnalysisPlan(working, path, "origin/main", binding);
  const local = await RunWork.open(store, "local", unpushed);
  try {
    expect((await local.entries())[0]).toEqual({ kind: "run-opened" });
    expect(registrationLabel("runner", true, local.receipt())).toBe("unregistered");
  } finally {
    await local.close();
  }

  git(working, "reset", "--hard", "origin/main");
  await writeFile(join(working, "readme.txt"), "unrelated update");
  const anchorTip = commit(working);
  git(working, "push", "origin", "main");
  const finalReceipt = { ...receipt, remoteSha: anchorTip };
  expect(await anchorAnalysisPlan(working, path, "origin/main", binding)).toEqual(finalReceipt);
  git(scratch, "clone", "--depth=1", pathToFileURL(bare).href, "shallow");
  const shallow = join(scratch, "shallow");
  expect(await anchorAnalysisPlan(shallow, path, "origin/main", binding)).toBeUndefined();
  git(shallow, "fetch", "--deepen=1", "origin", "main");
  expect(await anchorAnalysisPlan(shallow, path, "origin/main", binding)).toBeUndefined();
  git(shallow, "fetch", "--deepen=1", "origin", "main");
  expect(await anchorAnalysisPlan(shallow, path, "origin/main", binding)).toEqual(finalReceipt);

  git(working, "switch", "-c", "candidate");
  await writeFile(join(working, "candidate.txt"), "candidate change");
  commit(working);
  git(working, "push", "origin", "candidate");
  git(scratch, "clone", "--depth=1", "--branch", "candidate", pathToFileURL(bare).href, "ci-pr");
  const ci = join(scratch, "ci-pr");
  git(ci, "fetch", "--depth=1", "origin", "main");
  expect(await anchorAnalysisPlan(ci, path, "origin/main", binding)).toBeUndefined();
  git(ci, "fetch", "--deepen=3", "origin", "candidate", "main");
  expect(await anchorAnalysisPlan(ci, path, "origin/main", binding)).toEqual(finalReceipt);
  expect(registrationLabel("import", true, receipt)).toBe("exploratory");
  expect(registrationLabel("re-score", true, receipt)).toBe("exploratory");
  expect(registrationLabel("runner", false, receipt)).toBe("exploratory");
});

it("compares and hashes the exact file bytes", async () => {
  const { checkout: working } = await checkout("bytes");
  const path = "analysis-plan.json";
  const committed = Buffer.from([0x22, 0xff, 0x22, 0x0a]);
  await writeFile(join(working, path), committed);
  commit(working);
  git(working, "push", "origin", "main");
  const receipt = await anchorAnalysisPlan(working, path, "origin/main", binding);
  expect(receipt?.planFileDigest).toBe(
    `sha256:${createHash("sha256").update(committed).digest("hex")}`,
  );
  await writeFile(join(working, path), Buffer.from([0x22, 0xfe, 0x22, 0x0a]));
  expect(await anchorAnalysisPlan(working, path, "origin/main", binding)).toBeUndefined();
});

it("reads earlier candidates in a fresh checkout and refuses to re-use a spent case", async () => {
  const { checkout: working, bare } = await checkout("records");
  const records = await RecordsRepository.open(working);
  const historyKey = { suite: digest("a"), caseSet: digest("b"), base: digest("1") };
  await records.recordReads("candidate-1", "development", [digest("c")]);
  await records.appendDecision({
    ...historyKey,
    run: "candidate-1",
    candidate: digest("2"),
    decidedAt: at,
    verdict: "INCONCLUSIVE",
  });
  await records.appendDecision({
    ...historyKey,
    base: digest("3"),
    run: "another-base",
    candidate: digest("2"),
    decidedAt: at,
    verdict: "INCONCLUSIVE",
  });
  commit(working);
  git(working, "push", "origin", "main");
  git(scratch, "clone", pathToFileURL(bare).href, "ci");

  const fresh = await RecordsRepository.open(join(scratch, "ci"));
  expect(await fresh.earlierCandidates(historyKey)).toEqual([
    {
      ...historyKey,
      run: "candidate-1",
      candidate: digest("2"),
      decidedAt: at,
      verdict: "INCONCLUSIVE",
    },
  ]);
  await expect(fresh.recordReads("confirmation-1", "confirmation", [digest("c")])).rejects.toThrow(
    /already read/,
  );
  await fresh.recordReads("confirmation-1", "confirmation", [digest("d")]);
  await expect(fresh.recordReads("confirmation-1", "confirmation", [digest("d")])).rejects.toThrow(
    /already read/,
  );
  await expect(fresh.recordReads("confirmation-2", "confirmation", [digest("d")])).rejects.toThrow(
    /already read/,
  );
});

it("reserves a confirmation digest once across concurrent callers", async () => {
  const { checkout: working } = await checkout("records");
  const records = await RecordsRepository.open(working);
  const attempts = await Promise.allSettled([
    records.recordReads("confirmation-1", "confirmation", [digest("c")]),
    records.recordReads("confirmation-2", "confirmation", [digest("c")]),
  ]);
  expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
  expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);
});

it("requires a records repository for confirmation before any dispatch can begin", async () => {
  await expect(
    reserveCaseReads(undefined, "confirmation", "confirmation", [digest("c")]),
  ).rejects.toThrow(/confirmation requires a records repository/);
  await expect(
    reserveCaseReads(undefined, "development", "development", [digest("c")]),
  ).resolves.toBeUndefined();
});

it("matches read digests exactly regardless of case order or repeated input", async () => {
  const { checkout: working } = await checkout("records");
  const records = await RecordsRepository.open(working);
  await fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(fc.stringMatching(/^[a-f0-9]{64}$/), { minLength: 2, maxLength: 4 }),
      async (hashes) => {
        const cases = hashes.map((hash) => `sha256:${hash}`);
        const run = hashes[0];
        if (run === undefined) throw new Error("expected a digest");
        await records.recordReads(run, "confirmation", cases);
        await expect(
          records.recordReads(run, "confirmation", [...cases.toReversed(), ...cases]),
        ).rejects.toThrow(/already read/);
        await expect(records.recordReads(`other-${run}`, "confirmation", cases)).rejects.toThrow(
          /already read/,
        );
      },
    ),
    { numRuns: 12 },
  );
});
