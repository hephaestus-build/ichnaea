import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { Applicability } from "../../src/contracts/records/analysis-plan.ts";
import { digest } from "../../src/contracts/canonical.ts";
import { Trial } from "../../src/contracts/records/trial.ts";
import { createHost } from "../../src/core/host.ts";
import { recordRun } from "../../src/core/record-run.ts";
import { FileStore } from "../../src/core/store.ts";
import { decide } from "../../src/decide/decide.ts";
import { resolveAnalysis } from "../../src/plan/analysis.ts";

import { card, scenario } from "../decide/support/scenario.ts";

const at = "2026-11-24T00:00:00Z";
const measure = "app/correct";

async function evidence(directory: string) {
  const s = await scenario({ cases: 6, replicates: 2, base: () => 1, candidate: () => 0 });
  const base = s.plan.arms.find(({ role }) => role === "base");
  if (!base) throw new Error("fixture needs a base");
  const primary = s.plan.primary.map(({ measure: id, margin }) => ({ measure: id, margin }));
  const measureDefinition = card(measure);
  const host = createHost(
    {
      plugins: [
        {
          id: "app",
          version: "1.0.0",
          measures: [{ ...measureDefinition, card: { ...measureDefinition.card, id: measure } }],
        },
      ],
    },
    {
      core: "0.0.0",
      contracts: "0.0.0",
    },
  );
  const definition = host.measures.get(measure);
  if (!definition) throw new Error("fixture needs a measure");
  const { id: applicable } = s.cases[0] ?? { id: undefined };
  if (applicable === undefined) throw new Error("fixture needs a case");
  const primaryMeasure = primary[0];
  const version = s.values[0]?.version;
  if (!primaryMeasure || version === undefined)
    throw new Error("fixture needs values for its primary measure");
  const analysis = resolveAnalysis({
    suite: s.plan.suite,
    suiteDigest: s.plan.suiteDigest,
    caseSet: s.caseSet,
    base: base.configuration,
    blocks: 1,
    replicates: s.plan.replicates,
    primary,
    secondary: [],
    hardGates: [],
    applicability: Applicability.parse({ [measure]: [applicable] }),
    measures: [{ id: primaryMeasure.measure, version, pin: digest(definition.card) }],
    ichnaea: "0.0.0",
  });
  const sha = digest(analysis);
  const plan = {
    ...s.plan,
    analysis,
    trials: s.plan.trials.map((trial) => ({ ...trial, block: 0 })),
  };
  const trials = s.trials.map((trial) =>
    Trial.parse({
      ...trial,
      analysisPlan: sha,
      block: 0,
      context: "worker-0",
      startedAt: at,
      endedAt: at,
    }),
  );
  const store = new FileStore(directory);
  const input = {
    plan,
    host,
    store,
    cases: s.cases,
    id: "recorded",
    startedAt: at,
    completedAt: at,
    execution: {
      source: "runner" as const,
      blocks: [{ block: 0, plannedBlock: 0, first: "base" as const, status: "complete" as const }],
    },
  };
  return { input, store, trials, values: s.values, sha, applicable };
}

it("keeps the planned mask, seals its SHA, and demotes a missing execution time", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ichnaea-evidence-"));
  try {
    const { input, store, trials, values, sha, applicable } = await evidence(directory);
    const missing = trials.map(({ startedAt, ...trial }, index) =>
      index === 0 ? trial : { ...trial, ...(startedAt === undefined ? {} : { startedAt }) },
    );
    const offered = values.map((value) => {
      const trial = trials.find(({ id }) => id === value.trial);
      if (trial?.case !== applicable || trial.arm !== "candidate") return value;
      const { value: _removed, ...rest } = value;
      return { ...rest, applicable: false };
    });
    await recordRun({ ...input, result: { trials: missing, values: offered } });
    const stored = await store.read(input.id);
    expect(stored.trials.map(({ analysisPlan }) => analysisPlan)).toEqual(trials.map(() => sha));
    expect(stored.values).toHaveLength(4);
    expect(stored.run.execution).toMatchObject({ source: "runner", analysisPlan: sha });
    const decision = decide({ ...stored, decidedAt: at, ichnaea: "0.0.0" });
    expect(decision).toMatchObject({
      verdict: null,
      mode: "estimate-only",
      reason: expect.stringContaining("EXECUTION_UNRECORDED"),
    });
    expect(
      decision.measures[0]?.arms.find(({ arm }) => arm === "candidate")?.availability,
    ).toMatchObject({ planned: 2, available: 0, missing: 2 });
    expect(decision.measures[0]?.notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("APPLICABILITY_CONTRADICTS_PLAN"),
        expect.stringContaining("outside the planned applicability mask"),
      ]),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("refuses a judge-sourced primary value and a conflicting plan SHA before writing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ichnaea-evidence-"));
  try {
    const { input, store, trials, values } = await evidence(directory);
    const judged = values.map((value, index) =>
      index === 0 ? { ...value, source: "judge" as const } : value,
    );
    await expect(recordRun({ ...input, result: { trials, values: judged } })).rejects.toThrow(
      /judge.*primary/,
    );
    const wrongPlan = trials.map((trial, index) =>
      index === 0 ? Trial.parse({ ...trial, analysisPlan: digest("another analysis") }) : trial,
    );
    await expect(recordRun({ ...input, result: { trials: wrongPlan, values } })).rejects.toThrow(
      /analysis plan/,
    );
    expect(await store.runs()).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("checks model observations against the bound arm", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ichnaea-evidence-"));
  try {
    const { input, store, trials, values } = await evidence(directory);
    const observed = trials.map((trial, index) =>
      index === 0
        ? Trial.parse({
            ...trial,
            observed: [{ name: "model", value: "other", expected: "other" }],
          })
        : trial,
    );
    await recordRun({ ...input, result: { trials: observed, values } });
    const stored = await store.read(input.id);
    expect(stored.trials[0]).toMatchObject({
      outcome: "invalid_configuration",
      error: { kind: "configuration-mismatch" },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("requires the locked plan for runner evidence and distinguishes complete execution", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ichnaea-evidence-"));
  try {
    const { input, store, trials, values } = await evidence(directory);
    const { analysis: _analysis, ...legacyPlan } = input.plan;
    await expect(
      recordRun({ ...input, plan: legacyPlan, result: { trials, values } }),
    ).rejects.toThrow(/requires a locked analysis plan/);
    await recordRun({ ...input, result: { trials, values } });
    const stored = await store.read(input.id);
    const decision = decide({ ...stored, decidedAt: at, ichnaea: "0.0.0" });
    expect(decision.reason).toContain("requires randomized block inference");
    expect(decision.reason).not.toContain("EXECUTION_UNRECORDED");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
