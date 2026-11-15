// REQ-27, REQ-49, REQ-51, REQ-52, REQ-53, REQ-56: every verdict and rule, on complete records.
import { Decision } from "@hephaestus-build/ichnaea-contracts";
import { describe, expect, it } from "vitest";

import { decide, exitCode } from "../src/index.ts";
import { type Scenario, scenario } from "./support/scenario.ts";

const run = (s: Scenario) => decide({ ...s, decidedAt: "2026-11-15T12:00:00Z", ichnaea: "0.0.0" });

describe("run verdicts", () => {
  it("PASS: identical, stable arms on many cases", async () => {
    const d = await run(
      await scenario({
        cases: 60,
        replicates: 3,
        base: () => 0.97,
        candidate: () => 0.97,
        margin: 0.1,
      }),
    );
    expect(Decision.safeParse(d).success).toBe(true);
    expect(d.verdict).toBe("PASS");
    expect(d.measures[0]?.verdict).toBe("NON-INFERIOR");
  });

  it("REGRESSION: a large drop on every case", async () => {
    const d = await run(
      await scenario({
        cases: 60,
        replicates: 3,
        base: () => 0.95,
        candidate: () => 0.6,
        margin: 0.05,
      }),
    );
    expect(d.verdict).toBe("REGRESSION");
    expect(d.measures[0]?.verdict).toBe("REGRESSION");
    expect(
      d.measures[0]?.comparisons[0]?.flips.filter((f) => f.direction === "negative").length,
    ).toBeGreaterThan(0);
  });

  it("INCONCLUSIVE: too few cases for the margin, and INCONCLUSIVE never maps to a pass", async () => {
    const d = await run(
      await scenario({
        cases: 5,
        replicates: 2,
        base: () => 0.8,
        candidate: () => 0.8,
        margin: 0.02,
      }),
    );
    expect(d.verdict).toBe("INCONCLUSIVE");
    expect(
      exitCode(d, {
        onRegression: "block",
        onInconclusive: "block",
        onEstimateOnly: "report",
        onInvalid: "block",
      }),
    ).toBe(1);
  });

  it("INVALID: coverage below the floor", async () => {
    const d = await run(
      await scenario({
        cases: 20,
        replicates: 2,
        base: () => 0.9,
        candidate: () => 0.9,
        outcome: (t) =>
          t.arm === "candidate" && t.replicate === 1 ? "infrastructure_failure" : undefined,
      }),
    );
    expect(d.verdict).toBe("INVALID");
    expect(d.invalidReasons.join(" ")).toMatch(/coverage/);
  });

  it("INVALID: over budget, before any call", async () => {
    const d = await run(
      await scenario({
        cases: 10,
        replicates: 2,
        base: () => 0.9,
        candidate: () => 0.9,
        maxCalls: 5,
      }),
    );
    expect(d.verdict).toBe("INVALID");
    expect(d.invalidReasons.join(" ")).toMatch(/budget/);
  });

  it("INVALID: a hard gate without a result, and the run must belong to the plan", async () => {
    const s = await scenario({
      cases: 20,
      replicates: 2,
      base: () => 0.9,
      candidate: () => 0.9,
      hardGates: ["app/schema"],
    });
    expect((await run(s)).invalidReasons.join(" ")).toMatch(
      /hard gate 'app\/schema' has no result/,
    );
    const foreign = await run({
      ...s,
      gates: [{ gate: "app/schema", passed: true, failures: 0 } as never],
      run: { ...s.run, plan: `sha256:${"0".repeat(64)}` as never },
    });
    expect(foreign.verdict).toBe("INVALID");
  });

  it("REGRESSION: a failed hard gate wins over non-inferior measures", async () => {
    const d = await run(
      await scenario({
        cases: 60,
        replicates: 3,
        base: () => 0.97,
        candidate: () => 0.97,
        hardGates: ["app/schema"],
        gates: [{ gate: "app/schema", passed: false, failures: 2 } as never],
      }),
    );
    expect(d.verdict).toBe("REGRESSION");
    expect(d.reason).toMatch(/Hard gate/);
  });

  it("INVALID never maps to a pass under any policy", async () => {
    const d = await run(
      await scenario({
        cases: 10,
        replicates: 2,
        base: () => 0.9,
        candidate: () => 0.9,
        maxCalls: 5,
      }),
    );
    expect(
      exitCode(d, {
        onRegression: "report",
        onInconclusive: "report",
        onEstimateOnly: "report",
        onInvalid: "block",
      }),
    ).toBe(1);
  });
});

describe("estimands and estimate-only mode (REQ-49, REQ-27)", () => {
  it("a curated suite with one replicate gives no verdict, only descriptive estimates", async () => {
    const d = await run(
      await scenario({ cases: 20, replicates: 1, base: () => 0.9, candidate: () => 0.7 }),
    );
    expect(d.mode).toBe("estimate-only");
    expect(d.verdict).toBeNull();
    expect(d.measures[0]?.verdict).toBe("ESTIMATE-ONLY");
    expect(d.measures[0]?.comparisons[0]?.difference.lower).toEqual({ nonFinite: "-inf" });
  });

  it("every comparison states its estimand", async () => {
    const d = await run(
      await scenario({ cases: 30, replicates: 2, base: () => 0.9, candidate: () => 0.9 }),
    );
    for (const m of d.measures) expect(m.estimand).toBe("fixed-cases");
  });
});

describe("margins and multiplicity (REQ-51)", () => {
  it("a safety margin shifts the non-inferiority threshold", async () => {
    const base = {
      cases: 60,
      replicates: 3,
      base: () => 0.95,
      candidate: () => 0.93,
      margin: 0.08,
    } as const;
    const plain = await run(await scenario(base));
    const lower = plain.measures[0]?.comparisons[0]?.difference.lower as number;
    expect(plain.measures[0]?.verdict).toBe("NON-INFERIOR");
    // A safety margin that moves the threshold above the observed bound removes non-inferiority.
    const safety = 0.08 + lower + 0.005;
    const strict = await run(await scenario({ ...base, safetyMargin: safety }));
    expect(strict.measures[0]?.verdict).not.toBe("NON-INFERIOR");
  });

  it("applies Holm to the regression tests of the primary measures only", async () => {
    const d = await run(
      await scenario({
        cases: 40,
        replicates: 2,
        base: () => 0.9,
        candidate: () => 0.6,
        measures: ["app/a", "app/b", "app/c"],
        margin: 0.05,
      }),
    );
    const raw = d.measures.map((m) => m.comparisons[0]?.regressionP as number);
    const adjusted = d.measures.map((m) => m.comparisons[0]?.regressionPAdjusted as number);
    adjusted.forEach((a, i) => expect(a).toBeGreaterThanOrEqual(raw[i] as number));
  });
});

describe("missing data (REQ-56)", () => {
  it("compares missingness between arms and runs the sensitivity analysis", async () => {
    const d = await run(
      await scenario({
        cases: 60,
        replicates: 3,
        base: () => 0.95,
        candidate: () => 0.95,
        outcome: (t) =>
          t.arm === "candidate" && t.case === "case-001" && t.replicate === 0
            ? "infrastructure_failure"
            : undefined,
      }),
    );
    expect(d.missingness.differs).toBe(true);
    expect(d.missingness.sensitivity).not.toBe("not-needed");
    expect(d.missingness.byArm.find((a) => a.arm === "candidate")?.missing).toBe(1);
  });

  it("scores system failures as failures, never as missing (REQ-20)", async () => {
    const s = await scenario({
      cases: 30,
      replicates: 2,
      base: () => 1,
      candidate: () => 1,
      outcome: (t) => (t.arm === "candidate" && t.replicate === 0 ? "system_failure" : undefined),
    });
    // A system failure has no value from the application; the importer records it as a failure.
    for (const failed of s.trials.filter((t) => t.outcome === "system_failure")) {
      s.values.push({
        schema: "ichnaea.measureValue/1",
        trial: failed.id,
        measure: "app/correct",
        version: "1.0.0",
        applicable: true,
        value: { type: "binary", pass: false },
        source: "application",
        dataClass: "none",
      } as never);
    }
    const d = await run(s);
    expect(d.measures[0]?.arms.find((a) => a.arm === "candidate")?.availability.missing).toBe(0);
    expect(d.verdict).toBe("REGRESSION");
  });
});

describe("determinism", () => {
  it("decides the same records to the same record", async () => {
    const s = await scenario({ cases: 30, replicates: 2, base: () => 0.9, candidate: () => 0.85 });
    expect(JSON.stringify(await run(s))).toBe(JSON.stringify(await run(s)));
  });
});
