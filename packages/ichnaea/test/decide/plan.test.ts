import { describe, expect, it } from "vitest";

import { candidateRunsFirst } from "../../src/contracts/index.ts";
import { CORE_VERSION, PlanError } from "../../src/core/index.ts";
import { type PlanComparison, createPlan } from "../../src/decide/index.ts";
import { configuration, SUITE } from "../core/support/library.ts";

const base = configuration("base prompt", 0.2);
const candidate = configuration("candidate prompt", 0.2);
const comparison: PlanComparison = {
  run: "run-1",
  base,
  candidate,
  intendedChanges: ["/prompts/composer"],
  seed: 1,
  createdAt: "2026-11-16T12:00:00Z",
};

/** How decide seeds its generator: seed mod (2^32 - 1) + 1, so 0 and 2^32 - 1 would collide. */
const seedOf = (seed: number): number => (seed % 4294967295) + 1;

describe("createPlan", () => {
  it("lists every trial in alternating batches, with the power statement, in decision mode", () => {
    const { record, suite, run } = createPlan(SUITE, comparison);
    expect(suite).toBe(SUITE);
    expect(run).toBe("run-1");
    expect(record.mode).toBe("decision");
    expect(record.trials).toHaveLength(6 * 2 * 2);
    expect(record.trials.slice(0, 2).map((t) => t.id)).toEqual(["c1/base/r0", "c1/candidate/r0"]);
    expect(record.arms.map((a) => [a.name, a.role])).toEqual([
      ["base", "base"],
      ["candidate", "candidate"],
    ]);
    expect(record.primary.map((p) => p.measure)).toEqual([
      "composer/answered",
      "composer/declines",
    ]);
    expect(record.power.map((p) => p.computed)).toEqual([true, true]);
    // Each limit's registration record, as the suite gives it.
    expect(record.primary[0]).toEqual({
      measure: "composer/answered",
      margin: 0.3,
      marginStatus: "registered",
      marginReason: "Six cases at two trials see only drops above 0.23.",
      marginOwner: "composer maintainer",
    });
    expect(record.trigger).toBe("manual");
    expect(record.varies).toEqual(["prompt.composer"]);
    expect(record.ichnaea).toBe(CORE_VERSION);
    expect(record.seed).toEqual({ algorithm: "mt19937", value: "1" });
  });

  it("is deterministic for a given seed and creation time", () => {
    expect(createPlan(SUITE, comparison)).toEqual(createPlan(SUITE, comparison));
  });

  it("gives the cases of a slice more trials", () => {
    const sliced = { ...SUITE, trials: { default: 2, bySlice: { "expected=decline": 3 } } };
    const { record } = createPlan(sliced, comparison);
    const count = (c: string): number =>
      record.trials.filter((t) => t.case === c && t.arm === "base").length;
    expect([count("c1"), count("c4")]).toEqual([2, 3]);
  });

  it("at one trial per case, lists each pair in the order of its case's coin", () => {
    const { record } = createPlan({ ...SUITE, trials: { default: 1 } }, comparison);
    for (let i = 0; i < record.trials.length; i += 2) {
      const first = record.trials[i]!;
      expect(first.arm).toBe(candidateRunsFirst(record.seed, first.case) ? "candidate" : "base");
    }
  });

  it("plans a noise check: the base compared with itself, with nothing intended to change", () => {
    const { record } = createPlan(SUITE, {
      run: "noise-1",
      createdAt: "2026-11-16T12:00:00Z",
      seed: 1,
      base,
      candidate: base,
    });
    expect(record.arms[0]?.identity).toBe(record.arms[1]?.identity);
    expect(record.varies).toEqual([]);
    expect(record.mode).toBe("decision");
  });

  it("maps a whole member to every entry of it in either arm", () => {
    expect(
      createPlan(SUITE, { ...comparison, intendedChanges: ["/prompts"] }).record.varies,
    ).toEqual(["prompt.composer"]);
    expect(
      createPlan(SUITE, { ...comparison, intendedChanges: ["/parameters/temperature", "/models"] })
        .record.varies,
    ).toEqual(["model.composer", "parameter.temperature"]);
  });

  it.each([
    ["/models/composer/id", "names a part of one entry"],
    ["/description", "is outside the configuration identity"],
    ["/prompts/nope", "names nothing in either configuration"],
    ["prompts/composer", "is a JSON Pointer"],
    ["", "is a JSON Pointer"],
  ])("refuses the intended change %j", (pointer, message) => {
    expect(() => createPlan(SUITE, { ...comparison, intendedChanges: [pointer] })).toThrow(message);
  });

  it("refuses a seed outside 0 to below 10^9, so no two plan seeds collide under decide's seedOf", () => {
    expect(seedOf(0)).toBe(seedOf(4294967295));
    expect(createPlan(SUITE, { ...comparison, seed: 0 }).record.seed.value).toBe("0");
    expect(createPlan(SUITE, { ...comparison, seed: 999_999_999 }).record.seed.value).toBe(
      "999999999",
    );
    for (const seed of [4294967295, 1_000_000_000, -1, 1.5])
      expect(() => createPlan(SUITE, { ...comparison, seed })).toThrow(PlanError);
  });

  it("is pure: it needs its seed and its creation time, and reads no clock", () => {
    const { seed: _, ...unseeded } = comparison;
    expect(() => createPlan(SUITE, unseeded as PlanComparison)).toThrow(/seed/);
    const { createdAt: __, ...undated } = comparison;
    expect(() => createPlan(SUITE, undated as PlanComparison)).toThrow(/createdAt/);
  });

  it("refuses a comparison that is not valid, and a limit no run can decide", () => {
    expect(() =>
      createPlan(SUITE, { ...comparison, run: "", createdAt: "2026-11-16T12:00:00Z", seed: 1 }),
    ).toThrow(/comparison is not valid/);
    const tight = {
      ...SUITE,
      policy: { ...SUITE.policy, primary: { answered: { margin: 0.01, owner: "o", reason: "r" } } },
    };
    expect(() => createPlan(tight, comparison)).toThrow(/below the validated margin floor/);
  });

  it("runs estimate-only when a limit is a placeholder", () => {
    const placeholder = {
      ...SUITE,
      policy: {
        ...SUITE.policy,
        primary: {
          answered: {
            margin: 0.3,
            owner: "o",
            reason: "not set yet",
            status: "placeholder" as const,
          },
        },
      },
    };
    const { record } = createPlan(placeholder, comparison);
    expect(record.mode).toBe("estimate-only");
    expect(record.secondary).toEqual(["composer/declines"]);
  });
});
