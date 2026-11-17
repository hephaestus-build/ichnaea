// Invariant 10: no request, trial ID or batch order names base or candidate. The arms of a plan
// can carry the opaque names `a` and `b` from a coin on the seed, and each case's pair runs in the
// order of its own coin in every replicate.
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { armNames, canonicalize, candidateRunsFirst } from "../../src/contracts/index.ts";
import { createPlan, PlanError, type PlanInput } from "../../src/core/index.ts";
import { card, scenario } from "../decide/support/scenario.ts";

const lowBit = (value: unknown): boolean =>
  ((createHash("sha256").update(canonicalize(value), "utf8").digest()[0] as number) & 1) === 1;

describe("the arm names", () => {
  it("are a and b, the base b when the lowest bit of SHA-256 over { seed, use: 'arms' } is 1", () => {
    for (let n = 0; n < 16; n++) {
      const seed = { algorithm: "mt19937", value: String(n) };
      const expected = lowBit({ seed, use: "arms" })
        ? { base: "b", candidate: "a" }
        : { base: "a", candidate: "b" };
      expect(armNames(seed)).toEqual(expected);
    }
  });

  it("give the base either name, depending on the seed", () => {
    const bases = new Set(
      Array.from(
        { length: 32 },
        (_, n) => armNames({ algorithm: "mt19937", value: String(n) }).base,
      ),
    );
    expect(bases).toEqual(new Set(["a", "b"]));
  });
});

describe("the coin of a later replicate", () => {
  const seed = { algorithm: "mt19937", value: "7" };

  it("keeps the case coin at replicate 0, and hashes { seed, case, replicate } after it", () => {
    for (const id of Array.from({ length: 20 }, (_, i) => `c${i}`)) {
      expect(candidateRunsFirst(seed, id, 0)).toBe(candidateRunsFirst(seed, id));
      expect(candidateRunsFirst(seed, id)).toBe(lowBit({ seed, case: id }));
      expect(candidateRunsFirst(seed, id, 2)).toBe(lowBit({ seed, case: id, replicate: 2 }));
    }
  });
});

describe("a plan", async () => {
  const s = await scenario({ cases: 12, replicates: 3, base: () => 1, candidate: () => 1 });
  const input: PlanInput = {
    suite: s.suite,
    caseSet: s.caseSet,
    cases: s.cases,
    arms: s.plan.arms.map((a) => ({ role: a.role, configuration: a.configuration })),
    measures: new Map([["app/correct", card("app/correct")]]),
    gates: new Map(),
    trigger: "code",
    seed: 7,
    now: "2026-11-15T10:00:00Z",
    ichnaea: "0.0.0",
  };

  it("names an unnamed base and candidate by armNames, and records each name's role", async () => {
    for (let seed = 0; seed < 8; seed++) {
      const plan = await createPlan({ ...input, seed });
      const names = armNames(plan.seed);
      expect(plan.arms.map((a) => [a.name, a.role])).toEqual([
        [names.base, "base"],
        [names.candidate, "candidate"],
      ]);
      for (const t of plan.trials) expect(t.id).toMatch(/^case-\d{3}\/[ab]\/r\d$/);
    }
  });

  it("keeps the names its caller gives, as an import of another runner's sides needs", async () => {
    const plan = await createPlan({
      ...input,
      arms: s.plan.arms.map((a) => ({
        name: a.name,
        role: a.role,
        configuration: a.configuration,
      })),
    });
    expect(plan.arms.map((a) => a.name)).toEqual(["base", "candidate"]);
  });

  it("refuses an unnamed reference arm, which has no opaque name", async () => {
    const reference = { role: "reference" as const, configuration: s.plan.arms[0]!.configuration };
    await expect(createPlan({ ...input, arms: [...input.arms, reference] })).rejects.toThrow(
      PlanError,
    );
  });

  it("orders each case's pair in every replicate by its own coin, so the order never names the side", async () => {
    let pairs = 0;
    let baseFirst = 0;
    const rolesByBatch = new Map<number, Set<string>>();
    for (let seed = 0; seed < 40; seed++) {
      const plan = await createPlan({ ...input, seed });
      const roleOf = new Map(plan.arms.map((a) => [a.name as string, a.role]));
      for (const t of plan.trials) {
        const roles = rolesByBatch.get(t.batch) ?? new Set<string>();
        roles.add(roleOf.get(t.arm) ?? "");
        rolesByBatch.set(t.batch, roles);
      }
      for (let i = 0; i < plan.trials.length; i += 2) {
        const [first, second] = [plan.trials[i]!, plan.trials[i + 1]!];
        expect([second.case, second.replicate]).toEqual([first.case, first.replicate]);
        expect([first.batch, second.batch]).toEqual([first.replicate * 2, first.replicate * 2 + 1]);
        const candidateFirst = candidateRunsFirst(plan.seed, first.case, first.replicate);
        expect(roleOf.get(first.arm)).toBe(candidateFirst ? "candidate" : "base");
        pairs++;
        if (roleOf.get(first.arm) === "base") baseFirst++;
      }
    }
    expect(baseFirst / pairs).toBeGreaterThan(0.4);
    expect(baseFirst / pairs).toBeLessThan(0.6);
    for (const roles of rolesByBatch.values())
      expect(roles).toEqual(new Set(["base", "candidate"]));
  });

  it("numbers the batch r x n + k for n arms, a reference arm after the pair", async () => {
    const reference = {
      name: "ref",
      role: "reference" as const,
      configuration: s.plan.arms[0]!.configuration,
    };
    const plan = await createPlan({ ...input, arms: [...input.arms, reference] });
    const roleOf = new Map(plan.arms.map((a) => [a.name as string, a.role]));
    for (let i = 0; i < plan.trials.length; i += 3) {
      const trio = plan.trials.slice(i, i + 3);
      const r = trio[0]!.replicate;
      expect(trio.map((t) => t.batch)).toEqual([3 * r, 3 * r + 1, 3 * r + 2]);
      expect(trio[2]!.arm).toBe("ref");
      const candidateFirst = candidateRunsFirst(plan.seed, trio[0]!.case, r);
      expect(roleOf.get(trio[0]!.arm)).toBe(candidateFirst ? "candidate" : "base");
    }
  });
});
