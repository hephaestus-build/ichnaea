// Invariant 12: a trial's attempts are numbered 1 to k with no gap, and every attempt's calls count
// against the bound of calls per trial and the run's budget, so a retry cannot hide an overrun.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { type Decision, digest, Plan } from "../../src/contracts/index.ts";
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

/** The plan as a version before the bounds stored it: no callsPerTrial, no runs. */
const beforeBounds = (plan: Scenario["plan"]): Scenario["plan"] => {
  const { callsPerTrial: _, ...budget } = plan.budget;
  return { ...plan, budget, arms: plan.arms.map(({ runs: _r, ...arm }) => arm) };
};

/** A plan where Ichnaea runs the candidate and imports the base, whose trials record 5 calls. */
const mixed = (candidateCalls: number): Promise<Scenario> =>
  scenario({
    ...options,
    armsToRun: ["candidate"],
    usage: (t) => ({ calls: t.arm === "base" ? 5 : candidateCalls }),
  });

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

  it("in a mixed plan count only for the arm Ichnaea runs", async () => {
    // Ichnaea runs the candidate and imports the base: 40 trials each, the bound 2 per trial.
    const within = await mixed(1);
    expect(within.plan.arms.map((a) => [a.name, a.runs])).toEqual([
      ["base", undefined],
      ["candidate", true],
    ]);
    const decided = await run(within);
    expect(decided.invalidReasons).toEqual([]);
    expect(decided.limitations).toContain(
      "The imported trials recorded 200 calls. Ichnaea's budget applies only to the trials it runs.",
    );
    const over = await run(await mixed(3));
    expect(over.verdict).toBe("INVALID");
    expect(over.invalidReasons[0]).toMatch(
      /^40 trial\(s\) made more calls over their attempts than the bound of 2 per trial, for example '[^']*\/candidate\/r\d' \(3 calls\)$/,
    );
  });

  it("of a stored import plan without a bound per trial add no line on recompute", async () => {
    const s = await scenario({ ...options, armsToRun: [], usage: () => ({ calls: 2 }) });
    const plan = beforeBounds(s.plan);
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
    const plan = beforeBounds(s.plan);
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

  it("fail closed: a plan whose worst case is not its run trials times the bound is INVALID", async () => {
    // An absent runs means "not checked", so a plan with a bound per trial but no arm that
    // Ichnaea runs would otherwise check no call at all, without a word.
    const s = await scenario(options);
    expect(s.plan.budget.worstCaseCalls).toBe(160);
    const restamp = (plan: Scenario["plan"]): Scenario => ({
      ...s,
      plan,
      run: { ...s.run, plan: digest(plan) as Scenario["run"]["plan"] },
    });
    const unmarked = await run(
      restamp({ ...s.plan, arms: s.plan.arms.map(({ runs: _r, ...arm }) => arm) }),
    );
    expect(unmarked.verdict).toBe("INVALID");
    expect(unmarked.invalidReasons).toContain(
      "the plan books 160 calls in the worst case, but its 0 trial(s) of the arms Ichnaea runs need 0 at the bound of 2 per trial",
    );
    const understated = await run(
      restamp({ ...s.plan, budget: { ...s.plan.budget, worstCaseCalls: 100 } }),
    );
    expect(understated.verdict).toBe("INVALID");
    expect(understated.invalidReasons).toContain(
      "the plan books 100 calls in the worst case, but its 80 trial(s) of the arms Ichnaea runs need 160 at the bound of 2 per trial",
    );
  });

  it("fail closed: a plan that runs arms but states no bound per trial is INVALID", async () => {
    // Only a plan from before the bounds lacks callsPerTrial, and it has no runs either. A plan
    // that marks arms as run but has no bound would otherwise skip every call check.
    const s = await scenario({ ...options, usage: () => ({ calls: 50 }) });
    const { callsPerTrial: _, ...budget } = s.plan.budget;
    const plan = { ...s.plan, budget };
    const d = await run({
      ...s,
      plan,
      run: { ...s.run, plan: digest(plan) as Scenario["run"]["plan"] },
    });
    expect(d.verdict).toBe("INVALID");
    expect(d.invalidReasons).toContain(
      "the plan marks arm(s) base, candidate as run by Ichnaea but states no bound of calls per trial",
    );
  });

  it("leave a consistent mixed plan and a stored plan without a bound to decide", async () => {
    const m = await mixed(1);
    expect(m.plan.budget.worstCaseCalls).toBe(80);
    expect((await run(m)).invalidReasons).toEqual([]);
    // A stored plan books its worst case but no bound per trial: it is not checked.
    const s = await scenario(options);
    const plan = beforeBounds(s.plan);
    expect(plan.budget.worstCaseCalls).toBe(160);
    const stored: Scenario = {
      ...s,
      plan,
      run: { ...s.run, plan: digest(plan) as Scenario["run"]["plan"] },
    };
    const decision = await run(stored);
    expect(decision.invalidReasons).toEqual([]);
    expect(recompute({ ...stored, decision }).matches).toBe(true);
  });

  it("of every valid plan fixture with a bound per trial are booked as decide checks them", () => {
    // No valid fixture may show a plan that decide refuses for its call bounds.
    const fixtures = join(import.meta.dirname, "..", "..", "fixtures");
    const extra = join(fixtures, "valid-extra", "plan");
    const files = [
      join(fixtures, "valid", "plan.json"),
      ...readdirSync(extra).map((f) => join(extra, f)),
    ];
    const bounded = files
      .map((f) => Plan.parse(JSON.parse(readFileSync(f, "utf8"))))
      .filter((p) => p.budget.callsPerTrial !== undefined);
    expect(bounded.length).toBeGreaterThan(0);
    for (const p of bounded) {
      const runs = new Set(p.arms.filter((a) => a.runs === true).map((a) => a.name));
      const runTrials = p.trials.filter((t) => runs.has(t.arm)).length;
      expect(p.budget.worstCaseCalls).toBe(runTrials * (p.budget.callsPerTrial ?? 0));
    }
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
