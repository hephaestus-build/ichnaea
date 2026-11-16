// REQ-50, VALIDATION.md "Conditions for a validated result at one trial per case": at one trial per
// case and arm the 90% rule does not apply; the regression result is validated only when the
// caller states that its record checks passed, and the non-inferiority result never is.
import { describe, expect, it } from "vitest";

import {
  type CaseCounts,
  type ComparisonInput,
  compareCounts,
  createRng,
  NON_INFERIORITY_AT_ONE_TRIAL,
  ONE_TRIAL_NEEDS_CHECKS,
} from "../../src/stats/index.ts";

const one = (base: 0 | 1, candidate: 0 | 1, id: string): CaseCounts => ({
  id,
  base: { successes: base, trials: 1 },
  candidate: { successes: candidate, trials: 1 },
});
const cases = (n: number): CaseCounts[] =>
  Array.from({ length: n }, (_, i) =>
    one(1, i % 3 === 0 ? 0 : 1, `c${String(i).padStart(2, "0")}`),
  );
const at = (
  input: readonly CaseCounts[],
  oneTrial?: ComparisonInput["oneTrial"],
): ReturnType<typeof compareCounts> =>
  compareCounts({
    valueType: "binary",
    estimand: "fixed-cases",
    cases: input,
    alpha: 0.05,
    margin: 0.1,
    rng: createRng(1),
    ...(oneTrial === undefined ? {} : { oneTrial }),
  });

describe("the regression result at one trial per case and arm", () => {
  it("is not validated without the caller's checks, and the 90% rule is not the reason", () => {
    const c = at(cases(20));
    expect(c.regression).toEqual({ validated: false, limitations: [ONE_TRIAL_NEEDS_CHECKS] });
    expect(ONE_TRIAL_NEEDS_CHECKS).toBe(
      "one trial per case needs decide's checks of the trial order, the timestamps and the A/A runs",
    );
    expect(c.regressionMethod).toBe("exact-stratified-conditional");
  });

  it("is validated when the caller's checks passed", () => {
    const c = at(cases(20), { checksPassed: true, limitations: [] });
    expect(c.regression).toEqual({ validated: true, limitations: [] });
  });

  it("carries the caller's limitations, and is not validated when its checks failed", () => {
    expect(
      at(cases(20), { checksPassed: false, limitations: ["the records do not show when"] })
        .regression,
    ).toEqual({ validated: false, limitations: ["the records do not show when"] });
    // A failed check without a stated reason still names one.
    const unnamed = at(cases(20), { checksPassed: false, limitations: [] }).regression;
    expect(unnamed.validated).toBe(false);
    expect(unnamed.limitations).toHaveLength(1);
  });

  it("lets a case without its pair be excluded once the caller's checks passed (coverage counts it)", () => {
    const lost: CaseCounts = {
      id: "z",
      base: { successes: 1, trials: 1 },
      candidate: { successes: 0, trials: 0 },
    };
    const passed = at([...cases(20), lost], { checksPassed: true, limitations: [] });
    expect(passed.excludedCases).toBe(1);
    expect(passed.regression).toEqual({ validated: true, limitations: [] });
    // Without the caller's checks, nothing vouches for the exclusion.
    expect(at([...cases(20), lost]).regression.limitations).toContain(
      "1 case(s) have no completed trial in an arm and are excluded",
    );
  });

  it("needs 5 cases: below them, the case count is a limitation too", () => {
    expect(at(cases(4), { checksPassed: true, limitations: [] }).regression.limitations).toContain(
      "4 case(s); the validated domain starts at 5",
    );
  });
});

describe("the non-inferiority result at one trial per case and arm", () => {
  it("is never validated, whatever the caller's checks", () => {
    for (const oneTrial of [undefined, { checksPassed: true, limitations: [] }]) {
      const c = at(cases(40), oneTrial);
      expect(c.nonInferiority.validated).toBe(false);
      expect(c.nonInferiority.limitations).toContain(NON_INFERIORITY_AT_ONE_TRIAL);
    }
    expect(NON_INFERIORITY_AT_ONE_TRIAL).toBe(
      "non-inferiority is not validated at one trial per case",
    );
  });
});

const two = (id: string): CaseCounts => ({
  id,
  base: { successes: 2, trials: 2 },
  candidate: { successes: 1, trials: 2 },
});

describe("mixed one and two trials stay under the 90% rule", () => {
  it("2 of 12 cells with one trial is outside, also with the caller's one-trial checks", () => {
    const mixed = [...["a", "b", "c", "d", "e"].map(two), one(1, 1, "f")];
    for (const oneTrial of [undefined, { checksPassed: true, limitations: [] }])
      expect(at(mixed, oneTrial).regression.limitations).toEqual([
        "fewer than 90% of case-arm cells have 2 or more completed trials",
      ]);
  });

  it("1 of 10 cells with one trial is inside, and the one-trial reasons do not apply", () => {
    const edge = [
      ...["a", "b", "c", "d"].map(two),
      { id: "e", base: { successes: 2, trials: 2 }, candidate: { successes: 1, trials: 1 } },
    ];
    const c = at(edge);
    expect(c.regression).toEqual({ validated: true, limitations: [] });
    expect(c.nonInferiority.limitations).not.toContain(NON_INFERIORITY_AT_ONE_TRIAL);
  });
});
