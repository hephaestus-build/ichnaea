// REQ-15: arms may differ only in what the trigger varies by its kind and what the plan declares.
import type { Decision } from "@hephaestus-build/ichnaea-contracts";
import { describe, expect, it } from "vitest";

import { decide } from "../src/index.ts";
import { decideFloorSet } from "./support/floor-set.ts";
import { type Scenario, type ScenarioOptions, scenario } from "./support/scenario.ts";

const run = (s: Scenario): Promise<Decision> =>
  decide({ ...s, decidedAt: "2026-11-15T12:00:00Z", ichnaea: "0.0.0" });
// Refusals are about the records, not the cases: a small valid run decides them as well.
const small: ScenarioOptions = { cases: 6, replicates: 2, base: () => 1, candidate: () => 1 };
const stable: ScenarioOptions = {
  cases: 60,
  replicates: 3,
  base: () => 0.97,
  candidate: () => 0.97,
};

/** The candidate with a new prompt and without the code factor. */
const prompt = (c: Parameters<NonNullable<ScenarioOptions["candidateConfig"]>>[0]) => ({
  ...c,
  factors: {},
  prompts: [{ name: "answer", digest: `sha256:${"b".repeat(64)}`, status: "pinned" as const }],
});

describe("trigger factors (REQ-15)", () => {
  it("a code change whose candidate changes a generation parameter is INVALID", async () => {
    const d = await run(
      await scenario({
        ...small,
        candidateConfig: (c) => ({
          ...c,
          parameters: [{ name: "temperature", value: 1, status: "pinned", origin: "explicit" }],
        }),
      }),
    );
    expect(d.verdict).toBe("INVALID");
    // No trigger varies a generation parameter, so the run can only declare it.
    expect(d.reason).toMatch(
      /but the arms also differ in parameter\.temperature\. To allow it, use parameter\.temperature: --vary parameter\.temperature$/,
    );
  });

  it("a code change whose candidate changes a model-part factor (an endpoint) is INVALID", async () => {
    const d = await run(
      await scenario({
        ...small,
        candidateConfig: (c) => ({
          ...c,
          factors: {
            ...c.factors,
            "model.endpoint": { value: "https://other.example", status: "pinned", part: "model" },
          },
        }),
      }),
    );
    expect(d.verdict).toBe("INVALID");
    expect(d.reason).toMatch(
      /differ in factor\.model\.endpoint\. To allow it, use factor\.model\.endpoint: --trigger new-model or --vary factor\.model\.endpoint$/,
    );
  });

  it("a code change whose arms' trials report different model digests is INVALID", async () => {
    const d = await run(
      await scenario({
        ...small,
        observed: (t) => [{ name: "model.digest", value: t.arm === "base" ? "sha-a" : "sha-b" }],
      }),
    );
    expect(d.verdict).toBe("INVALID");
    expect(d.reason).toBe(
      "the arms' trials report different values of observed 'model.digest', which a code change may vary only the code part and what the plan declares as varied",
    );
    // The same observation on both arms is not a difference.
    const same = await run(
      await scenario({ ...stable, observed: () => [{ name: "model.digest", value: "sha-a" }] }),
    );
    expect(same.verdict).toBe("INCONCLUSIVE");
    expect(same.invalidReasons).toEqual([]);
  });

  it("a configuration change that varies what it does not declare is INVALID; declared, it decides", async () => {
    const undeclared = await run(
      await scenario({ ...small, trigger: "configuration", candidateModel: "model-b" }),
    );
    expect(undeclared.verdict).toBe("INVALID");
    expect(undeclared.reason).toBe(
      "a configuration change may vary only what the plan declares as varied, but the arms also differ in factor.code.commit, model.answer. To allow them, use factor.code.commit: --trigger code, --trigger dependency or --vary factor.code.commit; model.answer: --trigger new-model or --vary model.answer",
    );
    const partly = await run(
      await scenario({
        ...small,
        trigger: "configuration",
        candidateModel: "model-b",
        varies: ["model.answer"],
      }),
    );
    expect(partly.reason).toMatch(/also differ in factor\.code\.commit\. To allow it, use /);
  });

  it("a judge or case-set change may not vary the system at all", async () => {
    for (const trigger of ["judge", "case-set"] as const) {
      const d = await run(await scenario({ ...small, trigger, candidateModel: "model-b" }));
      expect(d.verdict).toBe("INVALID");
      expect(d.reason).toBe(
        // --vary is refused on such a trigger, so only another trigger can allow a difference.
        `a ${trigger} change may not vary the system at all, but the arms also differ in factor.code.commit, model.answer. To allow them, use factor.code.commit: --trigger code or --trigger dependency; model.answer: --trigger new-model`,
      );
    }
  });

  it("a new-model change may vary the model; a prompt it also changes must be declared", async () => {
    const base = { ...stable, trigger: "new-model", candidateModel: "model-b" } as const;
    const withPrompt = (await scenario({ ...base, candidateConfig: prompt })) as Scenario;
    // The base has no prompt and commit a1; the candidate differs in model, prompt and commit.
    expect((await run(withPrompt)).reason).toMatch(
      /^a new-model change may vary only the model part and what the plan declares as varied, but the arms also differ in factor\.code\.commit, prompt\.answer\. To allow them, use factor\.code\.commit: --trigger code, --trigger dependency or --vary factor\.code\.commit; prompt\.answer: --vary prompt\.answer$/,
    );
    const declared = await scenario({
      ...base,
      candidateConfig: prompt,
      varies: ["prompt.answer", "factor.code.commit"],
    });
    expect((await decideFloorSet(declared)).verdict).toBe("PASS");
  });
});
