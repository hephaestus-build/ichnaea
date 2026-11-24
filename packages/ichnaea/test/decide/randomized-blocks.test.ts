import fc from "fast-check";
import { expect, it } from "vitest";

import { digest } from "../../src/contracts/canonical.ts";
import { Trial } from "../../src/contracts/records/trial.ts";
import type { RunRecords } from "../../src/contracts/run-records.ts";
import { createHost } from "../../src/core/host.ts";
import { recordRun } from "../../src/core/record-run.ts";
import { report } from "../../src/report/report.ts";
import { BlockRunner } from "../../src/run/blocks.ts";
import { Applicability } from "../../src/contracts/records/analysis-plan.ts";
import { MeasureId, PlanDigest } from "../../src/contracts/primitives.ts";
import { exitCode } from "../../src/decide/ci-policy.ts";
import { compareBlocks } from "../../src/decide/block-comparison.ts";
import { pairFirst } from "../../src/contracts/block-order.ts";
import { decide } from "../../src/decide/decide.ts";
import { exactStratifiedTest } from "../../src/stats/exact-conditional.ts";
import { bothBoundsClear, sharpNullPairP } from "../../src/stats/randomized-blocks.ts";
import { resolveAnalysis } from "../../src/plan/analysis.ts";
import { card, scenario } from "./support/scenario.ts";

const at = "2026-11-24T00:00:00Z";
const measure = MeasureId.parse("app/correct");

async function records(
  blocks: number,
  replicates = 1,
  options: {
    readonly measures?: readonly string[];
    readonly concurrency?: number;
    readonly candidate?: number;
    readonly margin?: number;
    readonly safetyMargin?: number;
  } = {},
) {
  const s = await scenario({
    cases: 20,
    replicates: blocks * replicates,
    base: () => 1,
    candidate: () => options.candidate ?? 0,
    ...(options.measures === undefined ? {} : { measures: options.measures }),
  });
  const base = s.plan.arms.find((arm) => arm.role === "base");
  if (!base) throw new Error("fixture needs a base");
  const { margin, safetyMargin } = options;
  const primary = s.plan.primary.map(({ measure: id }) => ({
    measure: id,
    coverageFloor: 0.9,
    ...(margin === undefined ? {} : { margin }),
    ...(safetyMargin === undefined ? {} : { safetyMargin }),
  }));
  const analysis = resolveAnalysis({
    suite: s.plan.suite,
    suiteDigest: s.plan.suiteDigest,
    caseSet: s.caseSet,
    base: base.configuration,
    primary,
    applicability: Applicability.parse(
      Object.fromEntries(primary.map(({ measure: id }) => [id, s.cases.map((entry) => entry.id)])),
    ),
    measures: primary.map(({ measure: id }) => ({ id, version: "1.0.0", pin: digest("scorer") })),
    secondary: [],
    hardGates: [],
    blocks,
    replicates,
    ichnaea: "0.0.0",
  });
  const sha = digest(analysis);
  const blocksRun = Array.from({ length: blocks }, (_, block) => ({
    block,
    plannedBlock: block,
    status: "complete" as const,
    first: "base" as const,
    draws: s.cases.flatMap(({ id: caseId }) =>
      Array.from({ length: replicates }, (_slot, offset) => {
        const replicate = block * replicates + offset;
        const first = pairFirst(s.plan.seed, block, { case: caseId, replicate });
        return { case: caseId, replicate, first };
      }),
    ),
  }));
  const plan = {
    ...s.plan,
    primary: s.plan.primary.map((entry) => ({
      ...entry,
      margin: margin ?? 0,
      ...(safetyMargin === undefined ? {} : { safetyMargin }),
    })),
    power: [],
    mode: "decision" as const,
    modeReasons: [],
    schedule: { concurrency: options.concurrency ?? 1, endpoint: "fixture" },
    analysis,
    trials: s.plan.trials.map((t) => ({ ...t, block: Math.floor(t.replicate / replicates) })),
  };
  const trials = s.trials.map((trial) => {
    const block = Math.floor(trial.replicate / replicates);
    const rank = blocksRun[block]!.draws.findIndex(
      (draw) => draw.case === trial.case && draw.replicate === trial.replicate,
    );
    const first = blocksRun[block]!.draws[rank]!.first;
    const slot = 2 * rank + Number(trial.arm !== first);
    const timestamp = new Date(Date.parse(at) + block * 100_000 + 100 * slot).toISOString();
    return {
      ...trial,
      block,
      context: `context-${block}`,
      analysisPlan: sha,
      first,
      armOrderSeed: plan.seed,
      startedAt: timestamp,
      endedAt: timestamp,
    };
  });
  const run = {
    ...s.run,
    plan: PlanDigest.parse(digest(plan)),
    execution: { source: "runner" as const, analysisPlan: sha, seed: plan.seed, blocks: blocksRun },
  };
  return { ...s, plan, run, trials, decidedAt: at, ichnaea: "0.0.0" };
}

it("gives a directional sharp-null regression without a registered margin", async () => {
  const decision = decide(await records(5));
  expect(decision).toMatchObject({ verdict: "REGRESSION", cause: "statistical" });
  expect(decision.measures[0]?.comparisons[0]).toMatchObject({
    regressionPAdjusted: 1 / 32,
    regressionMethod: "randomized block sign-flip",
  });
});

it("passes a recorded run only with a registered margin inside the validated domain", async () => {
  const input = await records(5, 1, { candidate: 1, margin: 0.15 });
  const good = decide(input);
  const markdown = report({ ...input, decision: good }, { format: "markdown" });
  expect(markdown).toContain("PASS assumes a common shift across blocks");
  expect(markdown).not.toContain("It cannot yet show a regression across runs");
  expect(good).toMatchObject({ verdict: "PASS", reasonCode: "PASS" });
  expect(good.measures[0]?.comparisons[0]?.margin).toBe(0.15);
  expect(decide(await records(5, 1, { candidate: 1 })).verdict).toBe("INCONCLUSIVE");
  expect(
    decide(await records(5, 1, { candidate: 1, margin: 0.15, safetyMargin: 0.05 })).verdict,
  ).toBe("PASS");
  expect(
    decide(await records(5, 1, { candidate: 1, margin: 0.15, safetyMargin: 0.1 })).verdict,
  ).toBe("INCONCLUSIVE");
});

it("keeps each primary in Holm when its comparison does not reject", async () => {
  const second = MeasureId.parse("app/other");
  const s = await records(6, 1, { measures: [measure, second] });
  const neutralTrials = new Set(
    s.trials.filter((trial) => trial.arm === "candidate" && trial.block === 5).map(({ id }) => id),
  );
  const values = s.values.map((entry) =>
    entry.measure === second || neutralTrials.has(entry.trial)
      ? { ...entry, value: { type: "binary" as const, pass: true } }
      : entry,
  );
  const decision = decide({ ...s, values });
  expect(decision).toMatchObject({
    verdict: "INCONCLUSIVE",
    reasonCode: "DROP_IN_THESE_RUNS_ONLY",
  });
  expect(decision.measures[0]?.comparisons[0]).toMatchObject({
    regressionP: 1 / 32,
    regressionPAdjusted: 1 / 16,
  });
  expect(decision.measures[1]?.comparisons[0]?.regressionPAdjusted).toBe(1);
});

it("checks the seed and each recorded draw before admitting a block", async () => {
  const s = await records(5);
  const { seed: _removed, ...withoutSeed } = s.run.execution;
  const changedDraws = s.run.execution.blocks.map((block, index) =>
    index === 0
      ? {
          ...block,
          draws: block.draws.map((draw, rank) =>
            rank === 0
              ? {
                  ...draw,
                  first: draw.first === "base" ? ("candidate" as const) : ("base" as const),
                }
              : draw,
          ),
        }
      : block,
  );
  const changedTrials = s.trials.map((trial, index) =>
    index === 0
      ? { ...trial, first: trial.first === "base" ? ("candidate" as const) : ("base" as const) }
      : trial,
  );
  expect(decide({ ...s, run: { ...s.run, execution: withoutSeed } }).verdict).toBeNull();
  expect(
    decide({ ...s, run: { ...s.run, execution: { ...s.run.execution, blocks: changedDraws } } }),
  ).toMatchObject({
    verdict: null,
    reason: expect.stringContaining("does not match the seeded pair draws"),
  });
  expect(decide({ ...s, trials: changedTrials }).verdict).toBeNull();
});

it("holds one-block drops within the run and merges blocks sharing a context", async () => {
  const screen = await records(1, 2);
  const one = decide(screen);
  expect(one).toMatchObject({ verdict: "INCONCLUSIVE", reasonCode: "DROP_IN_THESE_RUNS_ONLY" });
  expect(exitCode(one, { ...screen.plan.policy, onInconclusive: "report" })).toBe(0);
  expect(exitCode(one, { ...screen.plan.policy, onRunDrop: "block" })).toBe(1);
  expect(
    exitCode(one, { ...screen.plan.policy, onInconclusive: "block", onRunDrop: "report" }),
  ).toBe(0);
  const s = await records(5);
  const trials = s.trials.map((trial) =>
    trial.block === 1 ? { ...trial, context: "context-0" } : trial,
  );
  const merged = decide({ ...s, trials });
  expect(merged).toMatchObject({ verdict: "INCONCLUSIVE", reasonCode: "DROP_IN_THESE_RUNS_ONLY" });
  expect(exitCode(merged, { ...s.plan.policy, onRunDrop: "block" })).toBe(1);
  expect(merged.measures[0]?.blocks).toMatchObject({ planned: 5, observed: 5, effective: 4 });
});

it("gives no statistical verdict with unrecorded execution or imported assignments", async () => {
  const s = await records(5);
  const trials = s.trials.map((trial, i) => {
    if (i > 0) return trial;
    const { startedAt: _removed, ...other } = trial;
    return other;
  });
  expect(decide({ ...s, trials })).toMatchObject({
    verdict: null,
    reasonCode: "EXECUTION_UNRECORDED",
  });
  const run = {
    ...s.run,
    exploratory: true,
    execution: { ...s.run.execution, source: "import" as const },
  };
  expect(decide({ ...s, run }).verdict).toBeNull();
});

it("refuses sequential arms even though the ledger has matching pair draws", async () => {
  const s = await records(5);
  const trials = s.trials
    .toSorted((a, b) => String(a.arm).localeCompare(String(b.arm)))
    .map((trial, rank) => {
      const time = new Date(Date.parse(at) + 100 * rank).toISOString();
      return { ...trial, startedAt: time, endedAt: time };
    });
  expect(decide({ ...s, trials })).toMatchObject({
    verdict: null,
    reasonCode: "ARMS_NOT_INTERLEAVED",
  });
});

it("refuses a pair outside the allowed start rank even when its first arm matches the draw", async () => {
  const s = await records(5);
  const trials = s.trials.map((trial) =>
    trial.block === 0 && trial.first !== trial.arm
      ? {
          ...trial,
          startedAt: new Date(Date.parse(trial.startedAt) + 5000).toISOString(),
          endedAt: new Date(Date.parse(trial.endedAt) + 5000).toISOString(),
        }
      : trial,
  );
  expect(decide({ ...s, trials })).toMatchObject({
    verdict: null,
    reasonCode: "ARMS_NOT_INTERLEAVED",
  });
});

it("requires each bound to clear the limit strictly", () => {
  expect(bothBoundsClear(-0.15, -0.05, 0.15)).toBe(false);
  expect(bothBoundsClear(-0.05, -0.15, 0.15)).toBe(false);
  expect(bothBoundsClear(-0.05, -0.05, 0.15)).toBe(true);
});

it("keeps an abandoned block out without shortening the planned horizon", async () => {
  const s = await records(5);
  const run = {
    ...s.run,
    execution: {
      ...s.run.execution,
      blocks: s.run.execution.blocks.map((block) =>
        block.block === 4 ? { ...block, status: "abandoned" as const } : block,
      ),
    },
  };
  const trials = s.trials.filter((trial) => trial.block !== 4);
  const decision = decide({ ...s, run, trials });
  expect(decision).toMatchObject({
    verdict: "INCONCLUSIVE",
    reasonCode: "TOO_FEW_BLOCKS",
    withinRunDrop: true,
    measures: [{ blocks: { planned: 5, observed: 4, effective: 4 } }],
  });
  expect(exitCode(decision, { ...s.plan.policy, onRunDrop: "block" })).toBe(1);
});

it("reports a within-run drop even when both bounds clear the margin", async () => {
  const s = await records(8, 1, { candidate: 1, margin: 0.15 });
  const losses = new Set(
    s.trials
      .filter((trial) => trial.block === 0 && trial.arm === "candidate")
      .slice(0, 6)
      .map((trial) => trial.id),
  );
  const values = s.values.map((value) =>
    losses.has(value.trial) ? { ...value, value: { type: "binary" as const, pass: false } } : value,
  );
  const decision = decide({ ...s, values });
  const bounds = decision.measures[0]?.comparisons[0]?.randomized;
  expect(bounds?.blockLower).toBeGreaterThan(-0.15);
  expect(bounds?.withinLower).toBeGreaterThan(-0.15);
  expect(decision).toMatchObject({
    verdict: "INCONCLUSIVE",
    reasonCode: "DROP_IN_THESE_RUNS_ONLY",
  });
  expect(exitCode(decision, { ...s.plan.policy, onRunDrop: "block" })).toBe(1);
});

it("reports claim-adverse completion for a missing trial", async () => {
  const s = await records(5, 1, { candidate: 1, margin: 0.15 });
  const missing = s.trials.find((trial) => trial.arm === "candidate");
  const trials = s.trials.map((trial) =>
    trial.id === missing?.id ? Trial.parse({ ...trial, outcome: "infrastructure_failure" }) : trial,
  );
  const values = s.values.filter((value) => value.trial !== missing?.id);
  const input = { ...s, trials, values };
  const decision = decide(input);
  expect(decision.verdict).toBe("INCONCLUSIVE");
  expect(decision.missingness.sensitivity).toBe("adverse-completion");
  expect(decision.measures[0]?.comparisons[0]?.randomized?.imputedTrials).toBe(1);
  const markdown = report({ ...input, decision }, { format: "markdown" });
  expect(markdown).toContain("1 of 100 trials missing");
  expect(markdown).toContain("The randomized tests fill missing scores against each claim.");
  expect(markdown).not.toContain("No primary measure misses");
});

it("counts a retry as missing evidence from the original assigned position", async () => {
  const s = await records(5);
  const original = s.trials.find((trial) => trial.first === trial.arm)!;
  const later = new Date(Date.parse(original.startedAt) + 20_000).toISOString();
  const trials = s.trials.map((trial) =>
    trial.id === original.id
      ? Trial.parse({
          ...trial,
          startedAt: later,
          endedAt: later,
          attempts: [
            { attempt: 1, failure: { class: "infrastructure", kind: "timeout" }, calls: 0 },
          ],
        })
      : trial,
  );
  const decision = decide({ ...s, trials });
  expect(decision).toMatchObject({ verdict: "REGRESSION", cause: "statistical" });
  expect(decision.missingness.byArm.find((row) => row.arm === original.arm)?.missing).toBe(1);
  expect(decision.measures[0]?.comparisons[0]?.randomized?.imputedTrials).toBe(1);
  const markdown = report({ ...s, trials, decision }, { format: "markdown" });
  expect(markdown).toContain("1 of 100 trials missing");
  expect(markdown).toContain("The analysis filled 1 missing score");
});

it("charges a missing trial against regression and retains the zero block in the sign set", () => {
  const pairs = Array.from({ length: 5 }, (_, i) => ({
    case: "c",
    block: i,
    group: i,
    base: `base-${i}`,
    candidate: `candidate-${i}`,
  }));
  const mask = new Set(["c"]);
  const complete = new Map(
    pairs.flatMap(
      (pair) =>
        [
          [pair.base, 1],
          [pair.candidate, 0],
        ] as const,
    ),
  );
  const options = { alpha: 0.05, blockEligible: true, replicates: 1 };
  expect(compareBlocks(pairs, mask, complete, options).blockP).toBe(1 / 32);
  const missing = new Map(complete);
  missing.delete("candidate-4");
  expect(compareBlocks(pairs, mask, missing, options)).toMatchObject({
    blockP: 1 / 16,
    withinPairs: 5,
    missing: 1,
  });
});

it("keeps a near-ceiling run inconclusive when the within-run lower bound fails", () => {
  const pairs = Array.from({ length: 100 }, (_, i) => ({
    case: String(i % 20),
    block: Math.floor(i / 20),
    group: Math.floor(i / 20),
    base: `base-${i}`,
    candidate: `candidate-${i}`,
  }));
  const mask = new Set(pairs.map((pair) => pair.case));
  const scores = new Map(
    pairs.flatMap(
      (pair, i) =>
        [
          [pair.base, 1],
          [pair.candidate, Number(i >= 80 || i % 20 !== 0)],
        ] as const,
    ),
  );
  const result = compareBlocks(pairs, mask, scores, {
    alpha: 0.05,
    blockEligible: true,
    replicates: 1,
    margin: 0.06,
  });
  expect(result.blockLower).toBeGreaterThan(-0.06);
  expect(result.withinLower).toBeLessThanOrEqual(-0.06);
  expect(result.pass).toBe(false);
  for (const pair of pairs) scores.set(pair.candidate, 1);
  expect(
    compareBlocks(pairs, mask, scores, {
      alpha: 0.05,
      blockEligible: true,
      replicates: 1,
      margin: 0.15,
    }),
  ).toMatchObject({ pass: true });
});

it("matches the exact stratified test when the strata are the same assigned pairs", () => {
  fc.assert(
    fc.property(fc.array(fc.tuple(fc.boolean(), fc.boolean()), { maxLength: 50 }), (pairs) => {
      const negative = pairs.filter(([base, candidate]) => base && !candidate).length;
      const positive = pairs.filter(([base, candidate]) => !base && candidate).length;
      const strata = pairs.map(([base, candidate]) => ({
        base: { successes: Number(base), trials: 1 },
        candidate: { successes: Number(candidate), trials: 1 },
      }));
      expect(sharpNullPairP(negative, positive)).toBeCloseTo(
        exactStratifiedTest(strata, "less").p,
        13,
      );
    }),
  );
  expect(sharpNullPairP(2, 0)).toBe(1 / 4);
  expect(
    exactStratifiedTest(
      [{ base: { successes: 2, trials: 2 }, candidate: { successes: 0, trials: 2 } }],
      "less",
    ).p,
  ).toBeCloseTo(1 / 6);
});

it("does not decide a regression from a legacy two-arm run without the locked pair assignments", async () => {
  const legacy = await scenario({ cases: 20, replicates: 3, base: () => 1, candidate: () => 0 });
  expect(decide({ ...legacy, decidedAt: at, ichnaea: "0.0.0" })).toMatchObject({
    mode: "estimate-only",
    verdict: null,
  });
});

it("seals concurrent pair draws and uses receipt order for equal timestamps", async () => {
  const s = await records(5, 1, { concurrency: 2 });
  const state = new BlockRunner(s.plan, { capacity: 2, deadlineMs: 100, maxAttempts: 1 });
  const completed = [];
  const trials: Trial[] = [];
  let nextTime = Date.parse(at);
  while (state.startBlock()) {
    for (let first = state.dispatch(nextTime); first; first = state.dispatch(nextTime)) {
      const second = state.dispatch(nextTime);
      expect(second?.started).toBe(first.started);
      if (!second) throw new Error("fixture needs a full pair");
      for (const attempt of [first, second]) {
        const recorded = s.trials.find((trial) => trial.id === attempt.trial.id)!;
        trials.push(
          Trial.parse({
            ...recorded,
            block: attempt.block,
            first: attempt.first,
            startedAt: new Date(attempt.started).toISOString(),
            endedAt: new Date(attempt.started + 1).toISOString(),
          }),
        );
        state.accept(
          attempt.block,
          { trial: attempt.trial, usage: { calls: 0, responseIds: [] } },
          nextTime + 1,
        );
      }
      nextTime += 2;
    }
    completed.push(state.finishBlock());
  }
  const written: RunRecords[] = [];
  const definition = card(measure);
  const host = createHost(
    {
      plugins: [
        {
          id: "app",
          version: "1.0.0",
          measures: [
            {
              ...definition,
              card: { ...definition.card, id: "app/correct" as const },
            },
          ],
        },
      ],
    },
    { core: "0.0.0", contracts: "0.0.0" },
  );
  await recordRun({
    host,
    store: {
      async createRun(run) {
        written.push(run);
      },
    },
    plan: s.plan,
    cases: s.cases,
    result: { trials, values: s.values },
    id: s.run.id,
    execution: { source: "runner", blocks: completed },
    startedAt: at,
    completedAt: new Date(nextTime).toISOString(),
  });
  const stored = written[0]!;
  expect(stored.run.execution?.seed).toEqual(s.plan.seed);
  expect(stored.run.execution?.blocks).toEqual(completed);
  expect(new Set(completed[0]?.draws.map((draw) => draw.first)).size).toBe(2);
  for (const trial of stored.trials) {
    const draw = completed[trial.block!]!.draws.find(
      (d) => d.case === trial.case && d.replicate === trial.replicate,
    );
    expect(trial.first).toBe(draw?.first);
    expect(trial.armOrderSeed).toEqual(s.plan.seed);
  }
  expect(
    decide({ ...stored, trials: stored.trials.toReversed(), decidedAt: at, ichnaea: "0.0.0" }),
  ).toMatchObject({
    verdict: "REGRESSION",
    cause: "statistical",
  });
});
