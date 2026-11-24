import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { bindImportedPlan, planSuite, writeAnalysis } from "../../src/core/analysis-plan.ts";
import { createHost } from "../../src/core/host.ts";
import { testMeasure } from "../../src/core/measures.ts";
import { card, configuration, scenario } from "../decide/support/scenario.ts";

it("binds fixture qualification to the scorer, examples and declared files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ichnaea-instrument-"));
  try {
    const s = await scenario({ cases: 1, replicates: 1, base: () => 1, candidate: () => 1 });
    const c = s.cases[0]!;
    const trial = s.trials[0]!;
    const { output: _output, pointer: _pointer, ...incomplete } = trial;
    const { validation: _validation, ...definition } = card("app/correct").card;
    const measure = {
      card: { ...definition, computedBy: "ichnaea" as const },
      score: (value: typeof trial) => ({ type: "binary" as const, pass: value.output === "yes" }),
      instrument: { files: ["threshold.txt"] },
      examples: {
        good: [
          {
            name: "answer",
            case: c,
            trial: { ...trial, output: "yes" },
            expected: { type: "binary" as const, pass: true },
          },
        ],
        bad: [
          {
            name: "wrong",
            case: c,
            trial: { ...trial, output: "no" },
            expected: { type: "binary" as const, pass: false },
          },
        ],
        nothing: [
          {
            name: "nothing",
            case: c,
            trial: { ...trial, output: "" },
            expected: { type: "binary" as const, pass: false },
          },
        ],
        incomplete: [
          { name: "no capture", case: c, trial: incomplete, expected: "missing" as const },
        ],
      },
    };
    const path = join(directory, "threshold.txt");
    await writeFile(path, "fixed threshold");
    const first = await testMeasure(measure, { directory });
    expect(first).toMatchObject({ status: "passed", qualification: "fixture-qualified" });
    const changed = {
      ...measure,
      score: (t: typeof trial) => ({ type: "binary" as const, pass: String(t.output) === "yes" }),
    };
    expect((await testMeasure(changed, { directory })).digest).not.toBe(first.digest);
    expect(
      (
        await testMeasure(
          {
            ...changed,
            card: {
              ...changed.card,
              validation: {
                tester: {
                  status: "passed",
                  digest: first.digest,
                  ranAt: "2026-11-24T00:00:00Z",
                },
              },
            },
          },
          { directory },
        )
      ).failures,
    ).toContainEqual(expect.stringContaining("tester is stale"));
    const suite = {
      id: "qualified",
      cases: "cases.jsonl",
      arms: { base: configuration("original") },
      objective: "Compare answers",
      construct: "Accuracy",
      decision: "Assess answers",
      scope: "Short answers",
      nonCoverage: "Long answers",
      primary: ["app/correct"],
    };
    const hostFor = (scorer: typeof measure) =>
      createHost(
        {
          plugins: [
            {
              id: "app",
              version: "1.0.0",
              measures: [
                {
                  ...scorer,
                  card: { ...scorer.card, id: "app/correct" as const },
                },
              ],
            },
          ],
        },
        { core: "0.0.0", contracts: "0.0.0" },
      );
    await writeFile(join(directory, "cases.jsonl"), JSON.stringify(c));
    await expect(
      planSuite({
        host: hostFor({
          ...measure,
          examples: {
            ...measure.examples,
            nothing: [],
            incomplete: [],
          },
        }),
        suite,
        directory,
        ichnaea: "0.0.0",
      }),
    ).rejects.toThrow(/do-nothing and incomplete-capture/);
    const locked = await planSuite({ host: hostFor(measure), suite, directory, ichnaea: "0.0.0" });
    expect(locked.lock.instruments).toMatchObject({ "app/correct": first.digest });
    await writeAnalysis(directory, locked, false);
    await expect(
      bindImportedPlan(
        {
          planPath: join(directory, "plan.json"),
          definition: suite,
          directory,
        },
        hostFor(changed),
        {
          trigger: s.plan.trigger,
          varies: [],
          createdAt: s.plan.createdAt,
          ichnaea: "0.0.0",
          seed: 3,
        },
      ),
    ).rejects.toThrow(/instrument pins differ/);
    const importedCard = {
      ...definition,
      id: "app/correct" as const,
      computedBy: "application" as const,
      validation: {
        tester: {
          status: "passed" as const,
          digest: first.digest,
          instrumentPin: first.digest,
          ranAt: "2026-11-24T00:00:00Z",
        },
      },
    };
    const importerHost = (operationalDefinition: string) =>
      createHost(
        {
          plugins: [
            {
              id: "app",
              version: "1.0.0",
              measures: [
                {
                  card: { ...importedCard, operationalDefinition },
                },
              ],
            },
          ],
        },
        { core: "0.0.0", contracts: "0.0.0" },
      );
    const oldCard = await planSuite({
      host: importerHost("Original definition"),
      suite,
      directory,
      ichnaea: "0.0.0",
    });
    const changedCard = await planSuite({
      host: importerHost("Changed definition"),
      suite,
      directory,
      ichnaea: "0.0.0",
    });
    expect(changedCard.plan.measures[0]?.pin).not.toBe(oldCard.plan.measures[0]?.pin);
    const emptyWithoutScore = {
      ...measure,
      score: (t: typeof trial) => (t.output === "" ? undefined : measure.score(t)),
      examples: {
        ...measure.examples,
        nothing: measure.examples.nothing.map((example) => ({
          ...example,
          expected: "missing" as const,
        })),
      },
    };
    expect((await testMeasure(emptyWithoutScore, { directory })).failures).toContainEqual(
      expect.stringContaining("do-nothing fixture needs an observed failing score"),
    );
    const bypassedCapture = {
      ...measure,
      examples: {
        ...measure.examples,
        incomplete: measure.examples.incomplete.map((example) => ({
          ...example,
          trial: { ...example.trial, outcome: "infrastructure_failure" as const },
        })),
      },
    };
    expect((await testMeasure(bypassedCapture, { directory })).failures).toContainEqual(
      expect.stringContaining("must exercise a completed trial with missing capture"),
    );
    await writeFile(path, "new threshold");
    expect((await testMeasure(measure, { directory })).digest).not.toBe(first.digest);
    const constant = {
      ...measure,
      score: () => ({ type: "binary" as const, pass: true }),
      examples: {
        ...measure.examples,
        bad: measure.examples.bad.map((example) => ({
          ...example,
          expected: { type: "binary" as const, pass: true },
        })),
        nothing: measure.examples.nothing.map((example) => ({
          ...example,
          expected: { type: "binary" as const, pass: true },
        })),
      },
    };
    expect((await testMeasure(constant, { directory })).status).toBe("failed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
