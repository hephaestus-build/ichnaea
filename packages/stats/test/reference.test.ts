// REQ-50, REQ-58, REQ-111: every interval matches pinned reference outputs from an independent
// implementation (R package ratesci, run as a test-only oracle by scripts/reference.R).
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { scoreDifferenceInterval, tangoInterval, wilson } from "../src/index.ts";

interface Bounds {
  lower: number;
  estimate: number;
  upper: number;
  level: number;
}
const reference = JSON.parse(
  readFileSync(join(import.meta.dirname, "reference-ratesci.json"), "utf8"),
) as {
  wilson: Array<Bounds & { x: number; n: number }>;
  difference: Array<
    Bounds & { x1: number; n1: number; x2: number; n2: number; skew: boolean; bcf: boolean }
  >;
  stratified: Array<
    Bounds & { x1: number[]; n1: number[]; x2: number[]; n2: number[]; skew: boolean; bcf: boolean }
  >;
  tango: Array<
    Bounds & {
      both: number;
      candidateOnly: number;
      baseOnly: number;
      neither: number;
      skew: boolean;
    }
  >;
};

/** The oracle solves its roots to about 1e-8; agreement is required to 1e-6. */
const TOLERANCE = 1e-6;
const close = (actual: number, expected: number): void => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOLERANCE);
};

describe("reference values (ratesci)", () => {
  it.each(reference.wilson.map((r) => [`${r.x}/${r.n} @${r.level}`, r] as const))(
    "Wilson %s",
    (_, r) => {
      const i = wilson({ successes: r.x, trials: r.n }, r.level);
      close(i.lower, r.lower);
      close(i.upper, r.upper);
    },
  );

  it.each(
    reference.difference.map(
      (r) =>
        [`${r.x1}/${r.n1} - ${r.x2}/${r.n2} @${r.level} skew=${r.skew} bcf=${r.bcf}`, r] as const,
    ),
  )("score difference %s", (_, r) => {
    const i = scoreDifferenceInterval(
      [{ candidate: { successes: r.x1, trials: r.n1 }, base: { successes: r.x2, trials: r.n2 } }],
      r.level,
      "two",
      {
        skewnessCorrection: r.skew,
        biasCorrection: r.bcf,
      },
    );
    // With skewness correction the oracle's point estimate is the root of the corrected score;
    // Ichnaea reports the observed difference as the estimate, so only bounds are compared.
    if (!r.skew) close(i.estimate, r.estimate);
    close(i.lower, r.lower);
    close(i.upper, r.upper);
  });

  it.each(
    reference.stratified.map(
      (r, k) => [`set ${Math.floor(k / 8)} @${r.level} skew=${r.skew} bcf=${r.bcf}`, r] as const,
    ),
  )("stratified score difference %s", (_, r) => {
    const strata = r.x1.map((x1, k) => ({
      candidate: { successes: x1, trials: r.n1[k] as number },
      base: { successes: r.x2[k] as number, trials: r.n2[k] as number },
    }));
    const i = scoreDifferenceInterval(strata, r.level, "two", {
      skewnessCorrection: r.skew,
      biasCorrection: r.bcf,
    });
    if (!r.skew) close(i.estimate, r.estimate);
    close(i.lower, r.lower);
    close(i.upper, r.upper);
  });

  it.each(
    reference.tango.map(
      (r) =>
        [
          `${r.both},${r.candidateOnly},${r.baseOnly},${r.neither} @${r.level} skew=${r.skew}`,
          r,
        ] as const,
    ),
  )("Tango paired %s", (_, r) => {
    const i = tangoInterval(r, r.level, "two", r.skew);
    if (!r.skew) close(i.estimate, r.estimate);
    close(i.lower, r.lower);
    close(i.upper, r.upper);
  });
});
