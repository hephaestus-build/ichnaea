import { describe, expect, it } from "vitest";

import { binary, defineSuite, SuiteError } from "../../src/core/index.ts";
import { suiteMeasures } from "../../src/core/suite.ts";
import { CASES, DEFINITION, SUITE, caseOf } from "./support/library.ts";

const refused = (change: Record<string, unknown>): string => {
  try {
    defineSuite({ ...DEFINITION, ...change } as unknown as typeof DEFINITION);
  } catch (error) {
    expect(error).toBeInstanceOf(SuiteError);
    return (error as Error).message;
  }
  throw new Error("defineSuite accepted the definition");
};

describe("defineSuite", () => {
  it("returns the definition unchanged", () => {
    expect(SUITE).toBe(DEFINITION);
  });

  it("requires every field of the card", () => {
    const { threats: _, ...card } = DEFINITION.card;
    expect(refused({ card })).toMatch(/card\.threats/);
  });

  it("refuses an invalid case and names it", () => {
    const broken = { ...caseOf("c7", "raise"), pool: "nowhere" };
    expect(refused({ cases: [...CASES, broken] })).toMatch(/cases\[6\]\.pool/);
  });

  it("refuses duplicate case IDs", () => {
    expect(refused({ cases: [...CASES, caseOf("c1", "raise")] })).toMatch(/duplicate case ID 'c1'/);
  });

  it("refuses a limit for a measure the suite does not define", () => {
    const policy = {
      ...DEFINITION.policy,
      primary: { ...DEFINITION.policy.primary, missing: { margin: 0.1, owner: "o", reason: "r" } },
    };
    expect(refused({ policy })).toMatch(/'missing' is not a measure of the suite/);
  });

  it("refuses a limit of 1 or more", () => {
    const policy = {
      ...DEFINITION.policy,
      primary: { answered: { margin: 1, owner: "o", reason: "r" } },
    };
    expect(refused({ policy })).toMatch(/a limit is a proportion below 1/);
  });

  it.each([
    ["a margin of 0", { margin: 0, owner: "o", reason: "r" }, "a limit is a proportion above 0"],
    ["no owner", { margin: 0.3, reason: "r" }, "primary.answered.owner"],
    ["a blank owner", { margin: 0.3, owner: " ", reason: "r" }, "a limit names the role"],
    ["a blank reason", { margin: 0.3, owner: "o", reason: "" }, "a limit states why"],
  ])("refuses a limit with %s", (_name, limit, message) => {
    const policy = {
      ...DEFINITION.policy,
      primary: { ...DEFINITION.policy.primary, answered: limit },
    };
    expect(refused({ policy })).toContain(message);
  });

  it("refuses a primary measure without known-good and known-bad examples", () => {
    const measures = {
      ...DEFINITION.measures,
      answered: binary({ score: () => ({ value: true }) }),
    };
    expect(refused({ measures })).toMatch(
      /primary measure 'answered' needs at least one known-good/,
    );
  });

  it("refuses a secondary measure that has a limit", () => {
    const policy = { ...DEFINITION.policy, secondary: ["answered"] };
    expect(refused({ policy })).toMatch(/'answered' has a limit, so it is primary/);
  });

  it("refuses a bySlice key that matches no case", () => {
    expect(refused({ trials: { default: 2, bySlice: { "expected=never": 3 } } })).toMatch(
      /'expected=never' matches no case/,
    );
  });

  it("refuses a measure that is not binary, and fields it does not know", () => {
    expect(refused({ measures: { answered: { score: () => true } } })).toMatch(/binary\(\)/);
    expect(refused({ gates: {} })).toMatch(/gates/);
  });

  it("refuses a configuration or changes that is not a function", () => {
    expect(refused({ configuration: {} })).toMatch(/configuration must be a function/);
  });
});

describe("binary", () => {
  it("builds today's binary card and a scorer over the raw output", () => {
    const measures = suiteMeasures(SUITE);
    const declines = measures.get("composer/declines");
    expect(declines?.card).toMatchObject({
      id: "composer/declines",
      version: "1.0.0",
      valueType: "binary",
      tier: "primary",
      computedBy: "ichnaea",
      unitOfEvaluation: "turn",
    });
    const c = declines?.examples?.good[0]?.case;
    const trial = declines?.examples?.good[0]?.trial;
    expect(c && trial && declines?.score?.(trial, c)).toEqual({
      value: { type: "binary", pass: true },
    });
    expect(declines?.score?.({ ...trial!, output: "not an output" }, c!)).toEqual({
      value: undefined,
    });
    expect(declines?.appliesTo?.(c!)).toBe(true);
  });
});
