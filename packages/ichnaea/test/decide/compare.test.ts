import { describe, expect, it } from "vitest";

import { digest } from "../../src/contracts/index.ts";
import { binary, importResults, type TimedResult } from "../../src/core/index.ts";
import { compare, createPlan } from "../../src/decide/index.ts";
import { answer, configuration, roleOf, SUITE } from "../core/support/library.ts";

const base = configuration("base prompt", 0.2);
const candidate = configuration("candidate prompt", 0.2);
const plan = createPlan(SUITE, {
  run: "run-1",
  seed: 1,
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

  it("ignores why: the same values without it give the same decision", () => {
    const { records } = importResults(
      plan,
      rows((arm) => roleOf(plan, arm) === "base"),
    );
    expect(records.values.some((v) => v.why !== undefined)).toBe(true);
    const bare = {
      ...records,
      values: records.values.map((v) => {
        const { why: _, ...rest } = v;
        return rest;
      }),
    };
    expect(compare(plan, bare, { decidedAt })).toEqual(compare(plan, records, { decidedAt }));
  });

  it("gives REGRESSION when the candidate stops answering", () => {
    const { records } = importResults(
      plan,
      rows((arm) => roleOf(plan, arm) === "base"),
    );
    const decision = compare(plan, records, { decidedAt });
    expect(decision.verdict).toBe("REGRESSION");
    expect(decision.measures.find((m) => m.measure === "composer/answered")?.verdict).toBe(
      "REGRESSION",
    );
  });

  it("is INVALID when a worker reported a protocol failure, whatever the other trials show", () => {
    const all = rows(() => true);
    const [t] = plan.record.trials;
    all[0] = {
      result: answer(t!, undefined, { failure: { class: "protocol", kind: "bad-request" } }),
    };
    const decision = compare(plan, importResults(plan, all).records, { decidedAt });
    expect(decision.verdict).toBe("INVALID");
    expect(decision.invalidReasons).toContain(
      "a worker reported a protocol failure (bad-request): the harness, not the system, failed",
    );
  });

  it("never reads a pointer as a failed output: pointer-only trials are missing", () => {
    // A scorer that reads a missing output as a fail would see the candidate fail every case.
    const naive = binary({
      ...SUITE.measures.answered,
      score: (o) => ({ value: String((o as { text?: string } | undefined)?.text ?? "") !== "" }),
    });
    const strict = { ...SUITE, measures: { ...SUITE.measures, answered: naive } };
    const p = createPlan(strict, {
      run: "pointers",
      seed: 1,
      createdAt: "2026-11-16T12:00:00Z",
      base,
      candidate,
      intendedChanges: ["/prompts/composer"],
    });
    const { records } = importResults(
      p,
      p.record.trials.map((t) => ({
        result:
          roleOf(p, t.arm) === "candidate"
            ? answer(t, undefined, { pointer: "trace-1" })
            : answer(t, { text: "answer", declined: true }),
      })),
    );
    const decision = compare(p, records, { decidedAt });
    expect(decision.verdict).not.toBe("REGRESSION");
    const candidateArm = p.record.arms.find((a) => a.role === "candidate")!.name;
    expect(decision.missingness.byArm.find((a) => a.arm === candidateArm)?.missing).toBe(12);
  });

  it("is INVALID when a trial made more calls than the bound", () => {
    const all = rows(() => true);
    all[0] = {
      result: answer(plan.record.trials[0]!, { text: "a", declined: true }, { calls: 5 }),
    };
    const decision = compare(plan, importResults(plan, all).records, { decidedAt });
    expect(decision.verdict).toBe("INVALID");
    expect(decision.invalidReasons).toContain("the run exhausted its budget");
  });

  it("is INVALID when the records belong to another plan", () => {
    const other = createPlan(SUITE, {
      run: "run-2",
      createdAt: "2026-11-16T12:00:00Z",
      base,
      candidate,
      seed: 7,
    });
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
      seed: 1,
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
          { temperature: roleOf(undeclared, t.arm) === "base" ? 0.2 : 0.9 },
        ),
      })),
    );
    const decision = compare(undeclared, records, { decidedAt });
    expect(decision.verdict).toBe("INVALID");
    expect(decision.invalidReasons[0]).toMatch(/parameter\.temperature/);
  });
});
