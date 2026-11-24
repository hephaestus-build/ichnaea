import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { MeasureValue } from "../../src/contracts/records/measure.ts";
import { Trial } from "../../src/contracts/records/trial.ts";
import { bindImportedPlan, planSuite, writeAnalysis } from "../../src/core/analysis-plan.ts";
import { createHost } from "../../src/core/host.ts";
import { recordRun } from "../../src/core/record-run.ts";
import { FileStore, main } from "../../src/index.ts";
import { card, configuration, scenario } from "../decide/support/scenario.ts";

const at = "2026-11-24T00:00:00Z";
const end = "2026-11-24T00:00:01Z";
const measure = "app/correct";

it("counts hits once, charges missing cases, and reports context and scope without a bound", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ichnaea-detector-"));
  try {
    const example = await scenario({ cases: 4, replicates: 2, base: () => 1, candidate: () => 1 });
    const suite = {
      id: "detector",
      cases: "cases.jsonl",
      blocks: 1,
      replicates: 2,
      objective: "Count hits",
      construct: "Unsafe output",
      decision: "Describe alerts",
      scope: "Short answers",
      nonCoverage: "Long answers",
      arms: { base: configuration("original") },
      mustNever: [
        {
          measure,
          cases: ["case-000", "case-001", "case-002"],
          scope: "Synthetic private-marker variants",
          detector: {
            kind: "deterministic" as const,
            variants: [{ pattern: "plain marker", positiveControl: "case-003" }],
          },
        },
      ],
    };
    await writeFile(
      join(directory, "cases.jsonl"),
      example.cases.map((record) => JSON.stringify(record)).join("\n"),
    );
    const definition = card(measure);
    const makeHost = (direction: "higher" | "lower", computedBy: "application" | "judge") =>
      createHost(
        {
          plugins: [
            {
              id: "app",
              version: "1.0.0",
              measures: [
                {
                  ...definition,
                  card: {
                    ...definition.card,
                    id: measure,
                    direction,
                    computedBy,
                    tier: "secondary",
                  },
                },
              ],
            },
          ],
        },
        { core: "0.0.0", contracts: "0.0.0" },
      );
    const host = makeHost("lower", "application");
    const input = { suite, host, directory, ichnaea: "0.0.0" };
    await expect(planSuite({ ...input, host: makeHost("higher", "application") })).rejects.toThrow(
      /lower values better/,
    );
    await expect(planSuite({ ...input, host: makeHost("lower", "judge") })).rejects.toThrow(
      /needs a model detector/,
    );
    const locked = await planSuite(input);
    await writeAnalysis(directory, locked, false);
    const { plan, cases } = await bindImportedPlan(
      { planPath: join(directory, "plan.json"), definition: suite, directory },
      host,
      {
        trigger: example.plan.trigger,
        varies: [],
        createdAt: at,
        ichnaea: "0.0.0",
        seed: 1,
      },
    );
    const trials = plan.trials
      .filter((trial) => trial.id !== "case-002/base/r1")
      .map((trial) =>
        Trial.parse({
          ...example.trials.find((record) => record.id === trial.id),
          configuration: locked.plan.base.identity,
          source: "offline",
          block: 0,
          context: "shared-worker",
          startedAt: at,
          endedAt: end,
        }),
      );
    const values = trials.map((trial) =>
      MeasureValue.parse({
        schema: "ichnaea.measureValue/1",
        trial: trial.id,
        measure,
        version: "1.0.0",
        source: "application",
        dataClass: "none",
        applicable: true,
        value: { type: "binary", pass: trial.case === "case-000" || trial.case === "case-003" },
      }),
    );
    const store = new FileStore(directory);
    await recordRun({
      host,
      store,
      plan,
      cases,
      result: { trials, values },
      id: "counted",
      execution: { source: "import" },
      startedAt: at,
      completedAt: end,
    });
    for (const command of ["decide", "report"]) {
      expect(await main([command, "--store", directory, "--run", "counted"], () => {})).toBe(0);
    }
    const out = join(directory, "runs", "counted", "report");
    const markdown = await readFile(join(out, "summary.md"), "utf8");
    const html = await readFile(join(out, "report.html"), "utf8");
    expect(markdown).toContain("| 3 | 1 | 1 | 1 |");
    expect(markdown).toContain("Synthetic private-marker variants");
    expect(markdown).toContain(String.raw`plain marker positive control \(case-003\): hit`);
    expect(markdown).toContain("shared-worker");
    expect(html).toContain(end);
    expect((await store.read("counted")).decision).toMatchObject({
      mustNever: [{ planned: 3, hits: 1, clean: 1, missing: 1 }],
    });
    for (const text of [markdown, html]) expect(text).not.toMatch(/ceiling|upper bound/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
