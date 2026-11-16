import { describe, expect, it } from "vitest";

import { digest } from "../../src/contracts/index.ts";
import { importResults, type TimedResult } from "../../src/core/index.ts";
import { compare, createPlan } from "../../src/decide/index.ts";
import { answer, configuration, SUITE } from "../core/support/library.ts";

const base = configuration("base prompt", 0.2);
const candidate = configuration("candidate prompt", 0.2);
const plan = createPlan(SUITE, {
  run: "run-1",
  base,
  candidate,
  intendedChanges: ["/prompts/composer"],
  createdAt: "2026-11-16T12:00:00Z",
});

/** One completed row per planned trial; `answers` says whether the arm answers the case. */
const rows = (answers: (arm: string, c: string) => boolean): TimedResult[] =>
  plan.record.trials.map((t) => ({
    result: answer(t, { text: answers(t.arm, t.case) ? "answer" : "", declined: true }),
  }));

const decidedAt = "2026-11-16T13:00:00Z";

describe("compare", () => {
  it("is synchronous and gives the same decision for the same records", () => {
    const { records } = importResults(
      plan,
      rows(() => true),
    );
    const decision = compare(plan, records, { decidedAt });
    expect(decision.verdict).not.toBeNull();
    expect(digest(compare(plan, records, { decidedAt }))).toBe(digest(decision));
    expect(decision.decidedAt).toBe(decidedAt);
    expect(decision.plan).toBe(digest(plan.record));
  });

  it("gives REGRESSION when the candidate stops answering", () => {
    const { records } = importResults(
      plan,
      rows((arm) => arm === "base"),
    );
    const decision = compare(plan, records, { decidedAt });
    expect(decision.verdict).toBe("REGRESSION");
    expect(decision.measures.find((m) => m.measure === "composer/answered")?.verdict).toBe(
      "REGRESSION",
    );
  });

  it("is INVALID when the records belong to another plan", () => {
    const other = createPlan(SUITE, { run: "run-2", base, candidate, seed: 7 });
    const { records } = importResults(
      other,
      rows(() => true),
    );
    expect(compare(plan, records, { decidedAt }).verdict).toBe("INVALID");
  });

  it("is INVALID when the arms differ beyond the intended changes", () => {
    const hotter = configuration("candidate prompt", 0.9);
    const undeclared = createPlan(SUITE, {
      run: "run-3",
      base,
      candidate: hotter,
      intendedChanges: ["/prompts/composer"],
      createdAt: "2026-11-16T12:00:00Z",
    });
    const { records } = importResults(
      undeclared,
      undeclared.record.trials.map((t) => ({
        result: answer(
          t,
          { text: "answer", declined: true },
          { temperature: t.arm === "base" ? 0.2 : 0.9 },
        ),
      })),
    );
    const decision = compare(undeclared, records, { decidedAt });
    expect(decision.verdict).toBe("INVALID");
    expect(decision.invalidReasons[0]).toMatch(/parameter\.temperature/);
  });
});
