// REQ-25, VALIDATION.md "One trial per case": at one trial per case and arm, the plan lists the
// trials case by case in an order a fair coin chose per case, and `batch` numbers the pairs.
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalize, candidateRunsFirst, type Plan } from "../../src/contracts/index.ts";
import { createPlan, type PlanInput } from "../../src/core/index.ts";
import { card, scenario } from "../decide/support/scenario.ts";

const seed = { algorithm: "mt19937", value: "7" };

describe("the coin that orders each pair", () => {
  it("is the lowest bit of the first byte of SHA-256 over the canonical { seed, case }", async () => {
    for (const id of ["case-000", "case-001", "a", "b/c", "ünï"]) {
      const first = createHash("sha256")
        .update(canonicalize({ seed, case: id }), "utf8")
        .digest()[0] as number;
      expect(await candidateRunsFirst(seed, id), id).toBe((first & 1) === 1);
    }
  });

  it("is fair over many cases, and depends on the seed", async () => {
    const ids = Array.from({ length: 400 }, (_, i) => `case-${i}`);
    const flips = await Promise.all(ids.map((id) => candidateRunsFirst(seed, id)));
    const heads = flips.filter(Boolean).length;
    // Binomial(400, 1/2): 200 ± 40 is beyond 4 standard deviations.
    expect(heads).toBeGreaterThan(160);
    expect(heads).toBeLessThan(240);
    const other = await Promise.all(
      ids.map((id) => candidateRunsFirst({ ...seed, value: "8" }, id)),
    );
    expect(other).not.toEqual(flips);
  });
});

describe("a plan at one trial per case and arm", async () => {
  const s = await scenario({ cases: 12, replicates: 1, base: () => 1, candidate: () => 1 });
  const input: PlanInput = {
    suite: s.suite,
    caseSet: s.caseSet,
    cases: s.cases,
    arms: s.plan.arms.map((a) => ({ name: a.name, role: a.role, configuration: a.configuration })),
    measures: new Map([["app/correct", card("app/correct")]]),
    gates: new Map(),
    trigger: "code",
    seed: 7,
    now: "2026-11-15T10:00:00Z",
    ichnaea: "0.0.0",
  };
  const plan = await createPlan(input);

  it("lists the trials case by case, the coin's first arm first, so its order is the run order", async () => {
    expect(plan.trials).toHaveLength(24);
    const order = await Promise.all(
      s.cases.map(async (c) =>
        (await candidateRunsFirst(plan.seed, c.id)) ? ["candidate", "base"] : ["base", "candidate"],
      ),
    );
    expect(plan.trials.map((t) => [t.case, t.arm])).toEqual(
      s.cases.flatMap((c, i) => (order[i] as string[]).map((arm) => [c.id, arm])),
    );
    // Both orders occur, so the order is not fixed by the arm.
    expect(new Set(order.map((o) => o[0])).size).toBe(2);
  });

  it("numbers the pairs: both trials of a case carry the case's index as their batch", () => {
    expect(plan.trials.map((t) => t.batch)).toEqual(s.cases.flatMap((_, i) => [i, i]));
  });

  it("is a decision plan for a binary primary measure", () => {
    expect(plan.mode).toBe("decision");
    expect(plan.modeReasons).toEqual([]);
  });

  it("stays estimate-only for a primary measure that is not binary", async () => {
    const p = await createPlan({
      ...input,
      measures: new Map([["app/correct", card("app/correct", "proportion")]]),
    });
    expect(p.mode).toBe("estimate-only");
    expect(p.modeReasons).toContain("one trial per case and arm is outside the validated domain");
  });

  it("keeps mixed one and two trials estimate-only, under the rule for two or more", async () => {
    const mixed = await scenario({
      cases: 12,
      replicates: 1,
      base: () => 1,
      candidate: () => 1,
      slices: (i) => (i < 3 ? { group: "small" } : undefined),
      replicatesFor: [{ slice: "group", value: "small", replicates: 2, reason: "few cases" }],
    });
    expect(mixed.plan.mode).toBe("estimate-only");
    expect(mixed.plan.modeReasons).toEqual([
      "one trial per case and arm is outside the validated domain",
    ]);
    // Alternating batches by replicate, as at two or more trials (REQ-25).
    expect(mixed.plan.trials[0]).toMatchObject({ case: "case-000", arm: "base", batch: 0 });
  });

  it("records the schedule and the cited A/A decisions it is given", async () => {
    const aa: NonNullable<Plan["aa"]> = {
      decisions: [
        { run: "aa-1" as never, digest: `sha256:${"1".repeat(64)}` },
        { run: "aa-2" as never, digest: `sha256:${"2".repeat(64)}` },
      ],
    };
    const p = await createPlan({ ...input, schedule: { concurrency: 4, endpoint: "example" }, aa });
    expect(p.schedule).toEqual({ concurrency: 4, endpoint: "example" });
    expect(p.aa).toEqual(aa);
    expect(plan.schedule).toBeUndefined();
    expect(plan.aa).toBeUndefined();
  });
});
