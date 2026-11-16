// Invariant 12: a trial's attempts are numbered 1 to k with no gap, and every attempt's calls count
// against the bound of calls per trial and the run's budget, so a retry cannot hide an overrun.
import type { Decision } from "../../src/contracts/index.ts";
import { describe, expect, it } from "vitest";

import { decide } from "../../src/decide/index.ts";
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

  it("count against the run's budget, which an import's plan does not book", async () => {
    // An import books no worst case, so only the calls on record can show an overrun.
    const d = await run(
      await scenario({
        ...options,
        maxCalls: 80,
        armsToRun: [],
        attempts: (t) => (first(t) ? [timeout(1, 1)] : undefined),
      }),
    );
    expect(d.verdict).toBe("INVALID");
    expect(d.invalidReasons).toEqual([
      "the run made 81 calls, over the budget of 80, counting every attempt",
    ]);
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
