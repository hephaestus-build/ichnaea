import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { digest } from "../../src/contracts/canonical.ts";
import { MeasureValue } from "../../src/contracts/records/measure.ts";
import { Run } from "../../src/contracts/records/run.ts";
import { Trial } from "../../src/contracts/records/trial.ts";
import { bindImportedPlan, planSuite, writeAnalysis } from "../../src/core/analysis-plan.ts";
import { createHost } from "../../src/core/host.ts";
import { runReduction } from "../../src/decide/trial-reduction.ts";
import { decide } from "../../src/decide/decide.ts";
import { report } from "../../src/report/report.ts";
import { card, configuration, scenario } from "../decide/support/scenario.ts";

const at = "2026-11-24T00:00:00Z";
const measure = "app/correct";
const registration = { measure, k: 3, cases: ["case-000", "case-001", "case-002"] };

it("locks one-arm reductions and reports fewer than k fresh trials as missing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ichnaea-reductions-"));
  try {
    const examples = await scenario({ cases: 3, replicates: 3, base: () => 1, candidate: () => 1 });
    const base = configuration("original");
    const suite = {
      id: "reductions",
      cases: "cases.jsonl",
      blocks: 1,
      replicates: 3,
      objective: "Observe answers",
      construct: "Accuracy",
      decision: "Describe quality",
      scope: "Short answers",
      nonCoverage: "Long answers",
      arms: { base },
      trialReduction: registration,
    };
    await writeFile(
      join(directory, "cases.jsonl"),
      examples.cases.map((record) => JSON.stringify(record)).join("\n"),
    );
    const known = card(measure);
    const host = createHost(
      {
        plugins: [
          {
            id: "app",
            version: "1.0.0",
            measures: [{ ...known, card: { ...known.card, id: measure } }],
          },
        ],
      },
      {
        core: "0.0.0",
        contracts: "0.0.0",
      },
    );
    const input = { suite, host, directory, ichnaea: "0.0.0" };
    await expect(
      planSuite({ ...input, suite: { ...suite, arms: { base, candidate: base } } }),
    ).rejects.toThrow(/trial reduction.*one arm/);
    await expect(
      planSuite({
        ...input,
        suite: { ...suite, trialReduction: { ...registration, cases: ["outside"] } },
      }),
    ).rejects.toThrow(/case 'outside' is not selected/);
    await expect(
      planSuite({
        ...input,
        suite: { ...suite, trialReduction: { ...registration, k: 4 } },
      }),
    ).rejects.toThrow(/k exceeds/);
    const locked = await planSuite(input);
    expect(locked.plan).toMatchObject({ trialReduction: registration });
    await writeAnalysis(directory, locked, false);
    const { plan } = await bindImportedPlan(
      { planPath: join(directory, "plan.json"), definition: suite, directory },
      host,
      {
        trigger: examples.plan.trigger,
        varies: [],
        createdAt: at,
        ichnaea: "0.0.0",
        seed: 5,
      },
    );
    const trials = plan.trials
      .filter((trial) => trial.id !== "case-002/base/r2")
      .map((trial) =>
        Trial.parse({
          ...examples.trials.find((entry) => entry.id === trial.id),
          configuration: locked.plan.base.identity,
          ...(trial.id === "case-001/base/r2" ? { cache: { hit: true } } : {}),
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
        value: { type: "binary", pass: true },
      }),
    );
    const { trialReduction, ...unregistered } = locked.plan;
    expect(runReduction({ ...plan, analysis: unregistered }, trials, values)).toBeUndefined();
    const shorter = {
      ...plan,
      analysis: { ...unregistered, trialReduction: { ...trialReduction!, k: 2 } },
    };
    const oneFailure = trials.map((trial) =>
      trial.id === "case-000/base/r0" ? { ...trial, outcome: "system_failure" as const } : trial,
    );
    const inapplicable = values.map((value) => {
      if (value.trial !== "case-002/base/r0") return value;
      const { value: _removed, ...rest } = value;
      return { ...rest, applicable: false };
    });
    expect(runReduction(shorter, oneFailure, inapplicable)?.cases).toMatchObject([
      { status: "estimate-only", passAll: 1 / 3, passAny: 1 },
      { status: "observed", passAll: 1, passAny: 1 },
      { status: "missing", validTrials: 1 },
    ]);
    const run = Run.parse({
      ...examples.run,
      plan: digest(plan),
      arms: plan.arms,
      exploratory: true,
      ledger: plan.trials.map((slot) => ({
        trial: slot.id,
        state: "recorded",
        outcome: trials.find((trial) => trial.id === slot.id)?.outcome ?? "not_run",
      })),
    });
    const decision = decide({
      plan,
      run,
      trials,
      values,
      gates: [],
      decidedAt: at,
      ichnaea: "0.0.0",
    });
    const records = { plan, run, trials, values, gates: [], decision };
    const markdown = report(records, { format: "markdown" });
    expect(markdown).toContain("| case-000 | 3 of 3 | 100.0% | 100.0% |");
    expect(markdown).toContain("| case-001 | 2 of 3 | Missing | Missing |");
    expect(markdown).toContain("| case-002 | 2 of 3 | Missing | Missing |");
    expect(markdown).toContain("Uncertainty unavailable.");
    expect(markdown).not.toMatch(/\b(confidence interval|95% interval)\b/);
    expect(report(records, { format: "html" })).toContain(
      "<td>case-002</td><td>2 of 3</td><td>Missing</td><td>Missing</td>",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
