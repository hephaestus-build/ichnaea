import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  bestCaseFloor,
  caseRates,
  detectableDecrease,
  regressionLimitations,
  simulateNoChange,
  plan,
  type Design,
} from "../src/planner/model.ts";
import { detectableSentence, MAX_SEED, plannerSeed } from "../src/planner/page.ts";

/** A share of 10,000 runs, as the landing page writes it. */
const percent = (count: number): string => `${((count / 10_000) * 100).toFixed(1)}%`;
const support: Design = { cases: 12, trials: 3, margin: 0.15, alwaysPass: 0.8, otherRate: 0.7 };

describe("planning explorer model", () => {
  it("puts the always-passing cases first", () => {
    expect(caseRates({ ...support, cases: 10 })).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 0.7, 0.7]);
  });

  it.each([
    [17, 2],
    [60, 3],
  ])("gives the closed-form floor at %i cases and %i trials", (cases, trials) => {
    const z = 1.6448536269514722;
    const closedForm = (z * z) / (cases * (trials - 0.5) + z * z);
    expect(bestCaseFloor({ ...support, cases, trials })).toBeCloseTo(closedForm, 2);
  });

  it("keeps the regression test's false alarms near 5% or below, and the threshold's above", () => {
    const runs = simulateNoChange(support, 400, 7);
    const se = Math.sqrt((0.05 * 0.95) / runs.runs);
    expect(runs.regressionAlarms / runs.runs).toBeLessThanOrEqual(0.05 + 3 * se);
    expect(runs.thresholdAlarms).toBeGreaterThan(runs.regressionAlarms);
  });

  // The landing page quotes the explorer's default design over 50 seeds of 200 runs. This keeps
  // the quote true.
  it("gives the landing page's numbers for the explorer's default design", () => {
    let regressions = 0;
    let thresholds = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const runs = simulateNoChange(support, 200, seed);
      regressions += runs.regressionAlarms;
      thresholds += runs.thresholdAlarms;
    }
    const landing = readFileSync(
      join(import.meta.dirname, "..", "src", "content", "docs", "index.mdx"),
      "utf8",
    );
    expect(landing).toContain(`blocks ${percent(thresholds)} of the runs`);
    expect(landing).toContain(`a drop in ${percent(regressions)} of the runs`);
  });

  it("repeats its numbers for the same seed", () => {
    expect(simulateNoChange(support, 50, 3)).toEqual(simulateNoChange(support, 50, 3));
  });

  it("detects a smaller decrease with more cases", () => {
    const options = { power: 0.8, runs: 60, seed: 11 };
    const small = detectableDecrease(support, options);
    const large = detectableDecrease({ ...support, cases: 60 }, options);
    expect(small).toBeDefined();
    expect(large).toBeLessThan(small ?? 0);
  });

  it("reports the library's own limitations outside the validated domain", () => {
    expect(regressionLimitations(support)).toEqual([]);
    expect(regressionLimitations({ ...support, cases: 4 })).not.toEqual([]);
    expect(regressionLimitations({ ...support, cases: 4, trials: 1 })).not.toEqual([]);
  });

  it("validates the regression test at one trial per case, assuming the record checks pass", () => {
    expect(regressionLimitations({ ...support, trials: 1 })).toEqual([]);
  });

  it("takes a seed from the address only when the generator accepts it and its successor", () => {
    expect(plannerSeed(null)).toBe(1);
    expect(plannerSeed("42")).toBe(42);
    expect(plannerSeed(String(MAX_SEED))).toBe(MAX_SEED);
    for (const raw of ["-1", "0", "1.5", "abc", String(MAX_SEED + 1)])
      expect(plannerSeed(raw)).toBeUndefined();
    expect(plan({ id: 1, design: support, seed: MAX_SEED }).ok).toBe(true);
  });

  it("answers a failed calculation with an error, so the page does not wait forever", () => {
    expect(plan({ id: 3, design: support, seed: -1 })).toEqual({
      id: 3,
      ok: false,
      error: "seed must be an integer in [1, 2^32 - 1], got -1",
    });
  });

  it("states the search resolution and the zero cap, and claims no precision", () => {
    const sentence = detectableSentence(0.2, 100, true);
    expect(sentence).toContain("or to zero if it is lower");
    expect(sentence).toContain("The search stops within 1 point.");
    expect(sentence).not.toContain("±");
    const page = readFileSync(
      join(import.meta.dirname, "..", "src", "content", "docs", "planner.mdx"),
      "utf8",
    );
    expect(page).toContain("capped at zero");
    expect(page).not.toContain("every case loses the same");
  });
});
