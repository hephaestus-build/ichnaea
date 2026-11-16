// compare is the library's decision: synchronous and pure, the same records and decidedAt give the
// same decision byte for byte, and it is decide over the plan and the run's records.
import { describe, expect, it } from "vitest";

import { digest } from "../../src/contracts/index.ts";
import { compare, decide } from "../../src/decide/index.ts";
import { scenario } from "./support/scenario.ts";

const decidedAt = "2026-11-16T13:00:00Z";
const s = await scenario({
  cases: 40,
  replicates: 2,
  base: () => 0.95,
  candidate: () => 0.5,
  opaque: true,
});

describe("compare", () => {
  it("is synchronous and gives the same decision for the same records", () => {
    const decision = compare(s.plan, s, { decidedAt });
    expect(decision).not.toBeInstanceOf(Promise);
    expect(digest(compare(s.plan, structuredClone(s), { decidedAt }))).toBe(digest(decision));
    expect(decision).toMatchObject({ verdict: "REGRESSION", decidedAt, plan: digest(s.plan) });
  });

  it("is decide over the plan and the records, at the plan's Ichnaea version", () => {
    const decided = decide({ ...s, decidedAt, ichnaea: s.plan.ichnaea });
    expect(compare(s.plan, s, { decidedAt })).toEqual(decided);
  });

  it("ignores a value's why: the same values with one give the same decision", () => {
    const explained = {
      ...s,
      values: s.values.map((v) => ({ ...v, why: "the answer names the policy" })),
    };
    expect(compare(s.plan, explained, { decidedAt })).toEqual(compare(s.plan, s, { decidedAt }));
  });

  it("is INVALID for the records of another plan", async () => {
    const other = await scenario({
      cases: 40,
      replicates: 2,
      base: () => 0.95,
      candidate: () => 0.5,
      opaque: true,
      seed: 8,
    });
    const decision = compare(s.plan, other, { decidedAt });
    expect(decision.verdict).toBe("INVALID");
    expect(decision.invalidReasons[0]).toMatch(/^the run belongs to plan sha256:/);
  });
});
