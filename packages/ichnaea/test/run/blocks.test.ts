import fc from "fast-check";
import { expect, it } from "vitest";

import { CaseId } from "../../src/contracts/primitives.ts";
import { canonicalize, digest } from "../../src/contracts/canonical.ts";
import { pairFirst } from "../../src/contracts/block-order.ts";
import { candidateRunsFirst } from "../../src/contracts/pair-order.ts";
import { resolveAnalysis } from "../../src/plan/analysis.ts";
import { BlockRunner, type Attempt } from "../../src/run/blocks.ts";

import { scenario } from "../decide/support/scenario.ts";

async function plan() {
  const s = await scenario({ cases: 6, replicates: 2, base: () => 1, candidate: () => 1 });
  const base = s.plan.arms.find(({ role }) => role === "base");
  if (!base) throw new Error("fixture needs the base arm");
  const analysis = resolveAnalysis({
    base: base.configuration,
    suite: s.plan.suite,
    suiteDigest: s.plan.suiteDigest,
    caseSet: s.caseSet,
    blocks: 2,
    replicates: 1,
    primary: [],
    secondary: [],
    hardGates: [],
    measures: [],
    applicability: {},
    maxCalls: s.plan.trials.length * 2,
    ichnaea: "0.0.0",
  });
  return {
    ...s.plan,
    analysis,
    trials: s.plan.trials.map((trial) => ({ ...trial, block: trial.replicate })),
    budget: {
      worstCaseCalls: s.plan.trials.length * 2,
      maxCalls: s.plan.trials.length * 2,
      callsPerTrial: 2,
    },
  };
}

const options = { capacity: 2, deadlineMs: 100, maxAttempts: 2 };
const result = (
  attempt: Attempt,
  calls: number,
  kind?: "infrastructure" | "system" | "protocol",
) => ({
  trial: attempt.trial,
  ...(kind === undefined ? { output: "answer" } : {}),
  usage: { calls, responseIds: [] },
  ...(kind === undefined ? {} : { failure: { class: kind, kind: "fixture" } }),
});

function next(runner: BlockRunner, now: number): Attempt {
  const attempt = runner.dispatch(now);
  if (!attempt) throw new Error("expected an eligible attempt");
  return attempt;
}

it("interleaves the two arms in the seeded order for each case and replicate", async () => {
  const locked = await plan();
  const runner = new BlockRunner(locked, options);
  let now = 0;
  for (let block = 0; block < 2; block++) {
    const started = runner.startBlock();
    expect(started).toMatchObject({
      block,
      plannedBlock: block,
      draws: expect.arrayContaining([
        expect.objectContaining({ first: "base" }),
        expect.objectContaining({ first: "candidate" }),
      ]),
    });
    expect(started?.draws).toHaveLength(6);
    for (let pair = 0; pair < 6; pair++) {
      const a = next(runner, now++);
      const b = next(runner, now++);
      expect(a.trial.case).toBe(b.trial.case);
      expect(a.trial.replicate).toBe(b.trial.replicate);
      const draw = started?.draws[pair];
      const first = pairFirst(locked.seed, block, a.trial);
      expect(draw).toEqual({ case: a.trial.case, replicate: a.trial.replicate, first });
      expect(a.first).toBe(first);
      expect(b.first).toBe(first);
      expect(a.trial.arm).toBe(locked.arms.find(({ role }) => role === first)?.name);
      expect(b.trial.arm).not.toBe(a.trial.arm);
      expect(runner.dispatch(now)).toBeUndefined();
      expect(runner.accept(block, result(b, 1), now).disposition).toBe("record");
      expect(runner.accept(block, result(a, 1), now).disposition).toBe("record");
    }
    expect(() => runner.abandonBlock()).toThrow(/settled block must be completed/);
    expect(runner.finishBlock()).toEqual({ ...started, status: "complete" });
  }
  expect(runner.startBlock()).toBeUndefined();
  expect(runner.calls).toBe(24);
  expect(digest(locked)).toBe(new BlockRunner(locked, options).planDigest);
});

it("keeps retries inside the trial cap and rejects late, duplicate, or unknown results", async () => {
  const runner = new BlockRunner(await plan(), { ...options, capacity: 1 });
  runner.startBlock();
  const first = next(runner, 0);
  expect(first.calls).toBe(2);
  expect(runner.accept(0, result(first, 1, "infrastructure"), 1).disposition).toBe("retry");
  const retry = next(runner, 2);
  expect(retry.trial).toEqual({ ...first.trial, attempt: 2 });
  expect(retry.calls).toBe(1);
  expect(() => runner.accept(0, result(first, 1), 3)).toThrow(/late/);
  const unknown = result(retry, 1);
  expect(() =>
    runner.accept(
      0,
      { ...unknown, trial: { ...unknown.trial, case: CaseId.parse("other-case") } },
      3,
    ),
  ).toThrow(/identity/);
  expect(() => runner.accept(0, result(retry, 1), 103)).toThrow(/late/);
  expect(runner.expire(103)).toMatchObject([{ attempt: retry, disposition: "timeout", calls: 1 }]);
  expect(() => runner.accept(0, result(retry, 1), 104)).toThrow(/late/);
  const other = next(runner, 104);
  expect(runner.accept(0, result(other, 1, "system"), 105).disposition).toBe("record");
  expect(() => runner.accept(0, result(other, 1), 106)).toThrow(/duplicate/);
  expect(() => runner.accept(99, result(other, 1), 106)).toThrow(/unknown block/);
});

it("charges an abandoned block before replacing it and refuses an unaffordable run", async () => {
  const locked = await plan();
  const insufficient = {
    ...locked,
    budget: { ...locked.budget, maxCalls: locked.budget.maxCalls - 1 },
  };
  expect(() => new BlockRunner(insufficient, options)).toThrow(/budget/);
  const runner = new BlockRunner(locked, options);
  runner.startBlock();
  const dispatched = next(runner, 0);
  expect(runner.abandonBlock()).toMatchObject({ block: 0, plannedBlock: 0, status: "abandoned" });
  expect(runner.calls).toBe(24);
  expect(() => runner.startBlock()).toThrow(/budget/);
  const larger = new BlockRunner(
    {
      ...locked,
      analysis: { ...locked.analysis, maxCalls: 72 },
      budget: { ...locked.budget, maxCalls: 72 },
    },
    options,
  );
  larger.startBlock();
  larger.abandonBlock();
  expect(larger.startBlock()).toMatchObject({
    block: 1,
    plannedBlock: 0,
    draws: locked.analysis.cases.map(({ id }) => ({
      case: id,
      replicate: 0,
      first: pairFirst(locked.seed, 1, { case: id, replicate: 0 }),
    })),
  });
  expect(() => larger.accept(0, result(dispatched, 1), 1)).toThrow(/late/);
});

it("draws a reproducible, domain-separated coin for each physical block, case and replicate", () => {
  fc.assert(
    fc.property(
      fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }),
      fc.nat(),
      fc.string(),
      fc.nat(),
      (seed, block, caseId, replicate) => {
        const input = { algorithm: "fixture", value: String(seed) };
        const pair = { case: caseId.toWellFormed(), replicate };
        const reference = candidateRunsFirst(
          input,
          canonicalize(["randomized-pair", block, pair.case]),
          replicate,
        );
        expect(pairFirst(input, block, pair)).toBe(reference ? "candidate" : "base");
        expect(pairFirst({ ...input }, block, { ...pair })).toBe(pairFirst(input, block, pair));
      },
    ),
  );
});

it("gives distinct pairs all four joint orders across sampled seeds", () => {
  fc.assert(
    fc.property(fc.nat(), fc.nat(), (block, replicate) => {
      for (const second of [
        { case: "second", replicate },
        { case: "first", replicate: replicate + 1 },
      ]) {
        const counts = new Map<string, number>();
        for (let index = 0; index < 256; index++) {
          const seed = { algorithm: "mt19937", value: String(index) };
          const a = pairFirst(seed, block, { case: "first", replicate });
          const b = pairFirst(seed, block, second);
          const joint = `${a}/${b}`;
          counts.set(joint, (counts.get(joint) ?? 0) + 1);
        }
        expect(counts.size).toBe(4);
        for (const count of counts.values()) {
          expect(count).toBeGreaterThanOrEqual(32);
          expect(count).toBeLessThanOrEqual(96);
        }
      }
    }),
    { seed: 109, numRuns: 24 },
  );
});

it("stops dispatch on a worker protocol failure", async () => {
  const runner = new BlockRunner(await plan(), options);
  runner.startBlock();
  const attempt = next(runner, 0);
  expect(runner.accept(0, result(attempt, 0, "protocol"), 1).disposition).toBe("protocol");
  expect(runner.dispatch(2)).toBeUndefined();
  expect(runner.abandonBlock().status).toBe("abandoned");
  expect(() => runner.startBlock()).toThrow(/failed the protocol/);
});

it("books the reported spend for a call overrun and stops the run", async () => {
  const runner = new BlockRunner(await plan(), options);
  runner.startBlock();
  const dispatched = next(runner, 0);
  expect(runner.accept(0, result(dispatched, 50), 1)).toMatchObject({
    attempt: dispatched,
    calls: 50,
    disposition: "budget-exceeded",
  });
  expect(runner.calls).toBe(50);
  expect(runner.dispatch(2)).toBeUndefined();
  runner.abandonBlock();
  expect(runner.calls).toBe(50);
  expect(() => runner.startBlock()).toThrow(/call bound/);
});

it("refuses to dispatch a plan missing a trial and supports a base-only plan", async () => {
  const locked = await plan();
  expect(() => new BlockRunner({ ...locked, trials: locked.trials.slice(1) }, options)).toThrow(
    /wrong trial horizon/,
  );
  const base = locked.arms.filter(({ role }) => role === "base");
  const baseName = base[0]?.name;
  const runner = new BlockRunner(
    {
      ...locked,
      arms: base,
      trials: locked.trials.filter(({ arm }) => arm === baseName),
    },
    options,
  );
  expect(runner.startBlock()?.draws).toEqual([]);
  expect(next(runner, 0).trial.arm).toBe(baseName);
});

it("retries a missing capture but never retries a truncated result", async () => {
  const locked = await plan();
  const runner = new BlockRunner(locked, { ...options, capacity: 1 });
  runner.startBlock();
  const first = next(runner, 0);
  const noCapture = { trial: first.trial, usage: { calls: 0, responseIds: [] } };
  expect(runner.accept(0, noCapture, 1).disposition).toBe("retry");

  const retry = next(runner, 2);
  expect(retry.trial).toEqual({ ...first.trial, attempt: 2 });
  expect(runner.accept(0, result(retry, 0), 3).disposition).toBe("record");

  const truncated = next(runner, 4);
  expect(runner.accept(0, { ...result(truncated, 0), truncated: true }, 5).disposition).toBe(
    "record",
  );
  expect(next(runner, 6).trial.id).not.toBe(truncated.trial.id);
});

it("picks up at the next physical draw after a completed and an abandoned block", async () => {
  const locked = await plan();
  const extended = {
    ...locked,
    analysis: { ...locked.analysis, maxCalls: 100 },
    budget: { ...locked.budget, maxCalls: 100 },
  };
  const draws = (block: number, planned: number) =>
    locked.trials
      .filter(({ block, arm }) => block === planned && arm === "base")
      .map(({ case: id, replicate }) => ({
        case: id,
        replicate,
        first: pairFirst(locked.seed, block, { case: id, replicate }),
      }));
  const history = [
    { block: 0, plannedBlock: 0, draws: draws(0, 0), status: "complete", calls: 12 },
    { block: 1, plannedBlock: 1, draws: draws(1, 1), status: "abandoned", calls: 2 },
  ] as const;
  const resumed = new BlockRunner(extended, options, history);
  expect(resumed.calls).toBe(36);
  expect(resumed.startBlock()).toEqual({
    block: 2,
    plannedBlock: 1,
    draws: draws(2, 1),
  });
  expect(
    () => new BlockRunner(extended, options, [history[0], { ...history[1], plannedBlock: 0 }]),
  ).toThrow(/journal/);
});
