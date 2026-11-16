// REQ-20: system failures and budget overruns score as failures on every binary measure, whatever
// the records say; infrastructure failures, including lost captures, count as missing.
import type { Decision } from "../../src/contracts/index.ts";
import { describe, expect, it } from "vitest";

import { decide } from "../../src/decide/index.ts";
import { type Scenario, scenario } from "./support/scenario.ts";

const run = (s: Scenario): Promise<Decision> =>
  decide({ ...s, decidedAt: "2026-11-15T12:00:00Z", ichnaea: "0.0.0" });
const candidateOf = (d: Decision) =>
  d.measures[0]?.arms.find((a) => a.arm === "candidate")?.availability;

describe("outcome classes on measures the application computes (REQ-20)", () => {
  it("a system failure without a value is a failed trial, not a missing one", async () => {
    const d = await run(
      await scenario({
        cases: 60,
        replicates: 3,
        base: () => 1,
        candidate: () => 1,
        margin: 0.05,
        outcome: (t) =>
          t.arm === "candidate" && Number(t.case.slice(5)) < 5 && t.replicate === 0
            ? "system_failure"
            : undefined,
      }),
    );
    expect(candidateOf(d)).toMatchObject({ planned: 180, available: 180, missing: 0 });
    expect(d.measures[0]?.arms.find((a) => a.arm === "candidate")?.rate.estimate).toBeCloseTo(
      175 / 180,
      10,
    );
  });

  it("a system failure that carries a passing value makes the run INVALID", async () => {
    const d = await run(
      await scenario({
        cases: 60,
        replicates: 3,
        base: () => 1,
        candidate: () => 1,
        margin: 0.05,
        outcome: (t) => (t.arm === "candidate" && t.replicate === 0 ? "system_failure" : undefined),
        value: (t) => (t.outcome === "system_failure" ? true : undefined),
      }),
    );
    expect(d.verdict).toBe("INVALID");
    expect(d.reason).toBe(
      "60 failed trial(s) carry a passing value, for example 'case-000/candidate/r0' (system_failure) for 'app/correct'; the records contradict themselves",
    );
  });

  it("an infrastructure failure that carries a value stays missing", async () => {
    const d = await run(
      await scenario({
        cases: 60,
        replicates: 3,
        base: () => 0.97,
        candidate: () => 0.97,
        outcome: (t) =>
          t.arm === "candidate" && t.case === "case-001" && t.replicate === 0
            ? "infrastructure_failure"
            : undefined,
        value: (t) => (t.outcome === "infrastructure_failure" ? false : undefined),
      }),
    );
    expect(candidateOf(d)).toMatchObject({ missing: 1, available: 179 });
  });
});
