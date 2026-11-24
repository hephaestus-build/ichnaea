import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { main } from "../../src/cli.ts";
import { digest, sha256 } from "../../src/contracts/canonical.ts";
import { FileStore } from "../../src/core/store.ts";
import { verifiedReport } from "../../src/report/report.ts";

it("verifies a legacy lock's case bytes and writes fresh v1 plan pins", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ichnaea-lock-migration-"));
  try {
    const config = join(directory, "ichnaea.config.ts");
    const cases = join(directory, "cases.jsonl");
    const legacy = join(directory, "suite.lock.json");
    const row = '{"id":"question","input":{"question":"Hello"}}\n';
    const lock = JSON.stringify({
      schema: "ichnaea.suite.lock/1",
      suite: "answers",
      suiteDigest: digest("previous suite"),
      measurementDigest: digest("previous measurements"),
      sources: [
        {
          origin: { file: "cases.jsonl" },
          digest: sha256(row),
          bytes: Buffer.byteLength(row),
          pools: { development: 1 },
        },
      ],
      instruments: {},
      measures: {},
      limits: {},
    });
    await writeFile(legacy, lock);
    await writeFile(cases, row);
    await writeFile(
      config,
      `export default {
      plugins: [], suite: {
        id: "answers", cases: "cases.jsonl", arms: { base: { model: "fixed" } },
        caseDefaults: {
          unit: "turn", dataClass: "none", pool: "development",
          provenance: { source: "authored", selection: "curated", created: "2026-11-24",
            exposure: "private", licence: "CC0-1.0" },
        },
        objective: "Compare answers", construct: "Accuracy", decision: "Release",
        scope: "Short answers", nonCoverage: ["Long answers"],
      },
    };`,
    );
    const newLock = join(directory, "ichnaea.lock");
    await writeFile(newLock, lock);
    expect(
      await main(
        ["plan", "--config", config, "--migrate-lock", newLock],
        () => {},
        undefined,
        () => {},
      ),
    ).toBe(2);
    await expect(readFile(newLock, "utf8")).resolves.toBe(lock);
    const args = ["plan", "--config", config, "--migrate-lock", legacy];
    const diagnostics: string[] = [];
    const cli = (...extra: string[]) =>
      main(
        [...args, ...extra],
        () => {},
        undefined,
        (line) => diagnostics.push(line),
      );

    expect(await cli(), diagnostics.join("\n")).toBe(0);
    const bytes = await readFile(newLock, "utf8");
    const plan: unknown = JSON.parse(await readFile(join(directory, "plan.json"), "utf8"));
    expect(JSON.parse(bytes)).toMatchObject({ schema: "ichnaea.lock/1", plan: digest(plan) });
    await expect(readFile(legacy, "utf8")).resolves.toBe(lock);
    expect(await cli("--frozen")).toBe(2);
    await writeFile(cases, row.replace("Hello", "World"));
    expect(await cli()).toBe(2);
    expect(diagnostics.join("\n")).toContain("the case file differs from the legacy lock");
    await expect(readFile(newLock, "utf8")).resolves.toBe(bytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("verifies the archived v1 seal and replays its evidence under a newer engine", async () => {
  const store = new FileStore(join(import.meta.dirname, "..", "..", "fixtures", "v1-replay"));
  const saved = await store.read("v1-replay");
  if (!saved.decision || !saved.manifest) throw new Error("the fixture needs its original seal");
  const report = verifiedReport(
    { ...saved, decision: saved.decision, aa: await store.aaEvidence(saved.plan) },
    { suite: saved.plan.suite },
    "0.0.1",
  );
  expect(saved.trials).toHaveLength(72);
  expect(saved.decision.verdict).toBe("INCONCLUSIVE");
  expect(report.recalculation).toMatchObject({
    manifest: digest(saved.manifest),
    decision: { ichnaea: "0.0.1", mode: "estimate-only", verdict: null },
  });
  expect(report.view.verdict).toBe("ESTIMATE-ONLY");
});
