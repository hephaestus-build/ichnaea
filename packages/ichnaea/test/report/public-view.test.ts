import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { canonicalize, digest } from "../../src/contracts/canonical.ts";
import { PlanDigest } from "../../src/contracts/primitives.ts";
import { GateResult } from "../../src/contracts/records/decision.ts";
import { decide } from "../../src/decide/index.ts";
import { decisionView, FileStore, main } from "../../src/index.ts";
import { resolveAnalysis } from "../../src/plan/analysis.ts";

import { scenario } from "../decide/support/scenario.ts";

it("gives two observed cases equal weight when their available trial counts differ", async () => {
  const s = await scenario({
    cases: 2,
    replicates: 3,
    base: (index) => Number(index === 0),
    candidate: () => 1,
    outcome: (trial) =>
      trial.arm === "base" && trial.case === "case-001" && trial.replicate === 2
        ? "infrastructure_failure"
        : undefined,
  });
  const decision = decide({ ...s, decidedAt: "2026-11-24T00:00:00Z", ichnaea: "0.0.0" });
  const view = decisionView({ ...s, decision });
  expect(view.measures[0]?.arms[0]).toMatchObject({
    rate: "50.0%",
    denominators: { observedCases: 2, plannedCases: 2, observedTrials: 5, plannedTrials: 6 },
  });
});

it("keeps protected gate detail out of machine output for decide and report", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ichnaea-public-"));
  try {
    const sentinel = "PROTECTED_GATE_DETAIL_SENTINEL";
    const gate = GateResult.parse({
      gate: "app/gate",
      passed: false,
      failures: 1,
      detail: sentinel,
    });
    const s = await scenario({
      cases: 2,
      replicates: 3,
      base: () => 1,
      candidate: () => 1,
      hardGates: [gate.gate],
      gates: [gate],
    });
    const store = new FileStore(directory);
    await store.createRun(s);
    for (const command of ["decide", "report"]) {
      const output: string[] = [];
      const errors: string[] = [];
      const code = await main(
        [command, "--json", "--store", directory, "--run", s.run.id],
        (line) => output.push(line),
        undefined,
        (line) => errors.push(line),
      );
      expect(code, errors.join("\n")).toBe(command === "decide" ? 1 : 0);
      expect(output).toHaveLength(1);
      expect(JSON.parse(output[0]!)).toMatchObject({ verdict: "REGRESSION" });
      expect(output[0]).not.toContain(sentinel);
    }
    expect((await store.read(s.run.id)).decision?.gates[0]?.detail).toBe(sentinel);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("writes one deterministic recalculation for an older sealed decision", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ichnaea-replay-"));
  try {
    const s = await scenario({ cases: 2, replicates: 2, base: () => 1, candidate: () => 1 });
    const old = decide({ ...s, decidedAt: "2026-11-24T00:00:00Z", ichnaea: "0.0.0-old" });
    const store = new FileStore(directory);
    await store.createRun(s);
    await store.writeDecision(old, s.plan.suite);
    const runDir = join(directory, "runs", s.run.id);
    const original = await readFile(join(runDir, "decision.json"), "utf8");
    const { manifest } = await store.read(s.run.id);
    expect(manifest).toMatchObject({
      ichnaea: old.ichnaea,
      inputs: { values: digest(s.values) },
      decision: digest(old),
    });
    for (let i = 0; i < 2; i++) {
      const output: string[] = [];
      expect(
        await main(["report", "--json", "--store", directory, "--run", s.run.id], (line) =>
          output.push(line),
        ),
      ).toBe(0);
      expect(output).toHaveLength(1);
      expect(output[0]).toContain("Recalculation");
      expect(JSON.parse(output[0] ?? "")).toMatchObject({
        schema: "ichnaea.reportView/1",
        measures: [
          {
            arms: expect.arrayContaining([
              expect.objectContaining({
                arm: "base",
                denominators: expect.objectContaining({ observedCases: 2, observedTrials: 4 }),
              }),
            ]),
          },
        ],
      });
    }
    expect(await readdir(join(runDir, "recalculations"))).toHaveLength(1);
    expect(await readFile(join(runDir, "decision.json"), "utf8")).toBe(original);
    // A changed unused gate must fail even when it cannot change the verdict.
    await writeFile(
      join(runDir, "gates.jsonl"),
      `${canonicalize({
        gate: "app/unused",
        passed: true,
        failures: 0,
      })}\n`,
    );
    const output: string[] = [];
    const errors: string[] = [];
    expect(
      await main(
        ["report", "--json", "--store", directory, "--run", s.run.id],
        (line) => output.push(line),
        undefined,
        (error) => errors.push(error),
      ),
    ).toBe(2);
    expect(output).toHaveLength(1);
    expect(errors).toEqual(output);
    expect(JSON.parse(output[0] ?? "")).toMatchObject({
      schema: "ichnaea.cli.error/1",
      code: "RECOMPUTE_MISMATCH",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("reports zero within-case variance and distinguishes dispersion on planned blocks", async () => {
  const s = await scenario({
    cases: 2,
    replicates: 4,
    base: (i) => Number(i === 0),
    candidate: () => 1,
    value: (trial) => (trial.arm === "candidate" && trial.replicate < 2 ? false : undefined),
  });
  const analysis = resolveAnalysis({
    suite: s.plan.suite,
    suiteDigest: s.plan.suiteDigest,
    caseSet: s.caseSet,
    base: s.plan.arms[0]!.configuration,
    blocks: 2,
    replicates: 2,
    primary: [],
    secondary: [],
    hardGates: [],
    measures: [],
    applicability: {},
    ichnaea: "0.0.0",
  });
  const plan = {
    ...s.plan,
    analysis,
    trials: s.plan.trials.map((slot) => ({
      ...slot,
      block: Math.floor(slot.replicate / 2),
    })),
  };
  const run = { ...s.run, plan: PlanDigest.parse(digest(plan)) };
  const decision = decide({ ...s, plan, run, decidedAt: "2026-11-24T00:00:00Z", ichnaea: "0.0.0" });
  const row = decisionView({ ...s, plan, run, decision }).measures[0];
  expect(row?.blocks).toMatchObject({ planned: 2, observed: 2, effective: null });
  expect(row?.noise).toMatchObject({
    arms: [
      { withinCaseVariance: 0, replicatedCells: 4, caseDispersion: 0.5 },
      { withinCaseVariance: 0, replicatedCells: 4, caseDispersion: 0 },
    ],
    betweenBlockVariance: 0.5,
    contrastBlocks: 2,
  });
});
