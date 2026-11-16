// Invariant 12: a trial's attempts are numbered 1 to k with no gap, and every attempt's calls count
// against the bound of calls per trial and the run's budget, so a retry cannot hide an overrun.
import { type Decision, digest } from "../../src/contracts/index.ts";
import { describe, expect, it } from "vitest";

import { decide } from "../../src/decide/index.ts";
import { recompute } from "../../src/report/index.ts";
import { type Scenario, scenario } from "./support/scenario.ts";

const run = (s: Scenario): Decision =>
  decide({ ...s, decidedAt: "2026-11-15T12:00:00Z", ichnaea: "0.0.0" });
const first = (t: { case: string; arm: string; replicate: number }): boolean =>
  t.case === "case-000" && t.arm === "candidate" && t.replicate === 0;
const timeout = (attempt: number, calls: number) => ({
  attempt,
  failure: { class: "infrastructure" as const, kind: "timeout" },
  calls,
});
const options = {
  cases: 20,
  replicates: 2,
  base: () => 1,
  candidate: () => 1,
  callsPerTrial: 2,
  usage: () => ({ calls: 1 }),
};

describe("a trial's attempts", () => {
  it("count against the bound of calls per trial, though the last attempt alone is within it", async () => {
    const d = await run(
      await scenario({ ...options, attempts: (t) => (first(t) ? [timeout(1, 2)] : undefined) }),
    );
    expect(d.verdict).toBe("INVALID");
    expect(d.invalidReasons).toContain(
      "1 trial(s) made more calls over their attempts than the bound of 2 per trial, for example 'case-000/candidate/r0' (3 calls)",
    );
  });

  it("within the bound change nothing", async () => {
    const plain = await run(await scenario(options));
    const retried = await run(
      await scenario({ ...options, attempts: (t) => (first(t) ? [timeout(1, 1)] : undefined) }),
    );
    expect(retried.verdict).toBe(plain.verdict);
    expect(retried.invalidReasons).toEqual([]);
  });

  it("count against the run's budget in a plan that runs its arms", async () => {
    // 20 cases x 2 trials x 2 arms at 2 calls each book exactly the budget of 80.
    const d = await run(
      await scenario({
        ...options,
        maxCalls: 80,
        usage: () => ({ calls: 2 }),
        attempts: (t) => (first(t) ? [timeout(1, 1)] : undefined),
      }),
    );
    expect(d.verdict).toBe("INVALID");
    expect(d.invalidReasons).toContain(
      "the run made 161 calls, over the budget of 80, counting every attempt",
    );
  });

  it("never make an import INVALID: another runner spent them, not Ichnaea", async () => {
    // An import plan runs no arm and books no worst case. Its trials keep their calls on record.
    const s = await scenario({
      ...options,
      maxCalls: 80,
      armsToRun: [],
      usage: () => ({ calls: 5 }),
      attempts: (t) => (first(t) ? [timeout(1, 3)] : undefined),
    });
    expect(s.plan.budget.worstCaseCalls).toBe(0);
    const d = await run(s);
    expect(d.verdict).not.toBe("INVALID");
    expect(d.invalidReasons).toEqual([]);
    expect(s.trials.find((t) => t.id === "case-000/candidate/r0")?.usage?.calls).toBe(5);
  });

  it("of a new import are reported in one limitation, and only when it recorded calls", async () => {
    const line =
      "The imported trials recorded 162 calls. Ichnaea's budget applies only to the trials it runs.";
    const imported = await scenario({
      ...options,
      armsToRun: [],
      usage: () => ({ calls: 2 }),
      attempts: (t) => (first(t) ? [timeout(1, 2)] : undefined),
    });
    expect(imported.plan.budget.callsPerTrial).toBe(2);
    expect((await run(imported)).limitations).toContain(line);
    const silent = await run(await scenario({ ...options, armsToRun: [], usage: () => ({}) }));
    expect(silent.limitations.some((l) => l.startsWith("The imported trials"))).toBe(false);
    // A plan that runs its arms books its calls, so it gets no such line.
    const ran = await run(await scenario(options));
    expect(ran.limitations.some((l) => l.startsWith("The imported trials"))).toBe(false);
  });

  it("of a stored import plan without a bound per trial add no line on recompute", async () => {
    const s = await scenario({ ...options, armsToRun: [], usage: () => ({ calls: 2 }) });
    const { callsPerTrial: _, ...budget } = s.plan.budget;
    const plan = { ...s.plan, budget };
    const stored: Scenario = {
      ...s,
      plan,
      run: { ...s.run, plan: digest(plan) as Scenario["run"]["plan"] },
    };
    const decision = await run(stored);
    expect(decision.limitations.some((l) => l.startsWith("The imported trials"))).toBe(false);
    expect(recompute({ ...stored, decision }).matches).toBe(true);
  });

  it("leave a stored plan without a bound per trial decided as before", async () => {
    // A plan written before the bound per trial was recorded: its run's calls are over the
    // budget, and decide must give the decision that was stored for it.
    const s = await scenario({ ...options, maxCalls: 160, usage: () => ({ calls: 1 }) });
    const { callsPerTrial: _, ...budget } = s.plan.budget;
    const plan = { ...s.plan, budget };
    const stored: Scenario = {
      ...s,
      plan,
      run: { ...s.run, plan: digest(plan) as Scenario["run"]["plan"] },
    };
    const over: Scenario = {
      ...stored,
      trials: stored.trials.map((t) => ({ ...t, usage: { calls: 3 } })),
    };
    const decision = await run(over);
    expect(decision.invalidReasons).toEqual([]);
    expect(recompute({ ...over, decision }).matches).toBe(true);
    expect(decision).toEqual(await run(stored));
  });

  it("are numbered 1 to k with no gap", async () => {
    const d = await run(
      await scenario({
        ...options,
        attempts: (t) => (first(t) ? [timeout(1, 0), timeout(3, 0)] : undefined),
      }),
    );
    expect(d.verdict).toBe("INVALID");
    expect(d.invalidReasons).toContain(
      "trial 'case-000/candidate/r0' lists attempts 1, 3; they must be numbered 1 to k with no gap",
    );
  });
});
