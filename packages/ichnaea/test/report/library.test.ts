import { describe, expect, it } from "vitest";

import { importResults } from "../../src/core/index.ts";
import { compare, createPlan } from "../../src/decide/index.ts";
import { report, ReportError } from "../../src/report/index.ts";
import { answer, configuration, SUITE } from "../core/support/library.ts";

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
const rows = plan.record.trials.map((t) => ({
  result: answer(t, { text: t.arm === "base" ? "answer" : "", declined: true }),
}));
const { records } = importResults(plan, rows);
const decision = compare(plan, records, { decidedAt: "2026-11-16T13:00:00Z" });

describe("report", () => {
  it("renders Markdown with the verdict, the measures and the lineage", () => {
    const text = report(decision, { format: "markdown", suite: "composer" });
    expect(text).toContain("Ichnaea decision: composer");
    expect(text).toContain("REGRESSION");
    expect(text).toContain("composer/answered");
    expect(text).toContain("Lineage");
  });

  it("renders HTML, and the view model as JSON", () => {
    expect(report(decision, { format: "html", lineage: records.run.lineage })).toMatch(
      /^<!doctype html>/i,
    );
    const view = JSON.parse(report(decision, { format: "json" })) as {
      verdict: string;
      title: string;
    };
    expect(view).toMatchObject({ verdict: "REGRESSION", title: "Ichnaea decision: run run-1" });
  });

  it("is synchronous and the same for the same decision", () => {
    expect(report(decision, { format: "markdown" })).toBe(report(decision, { format: "markdown" }));
  });

  it("refuses to render a report the lint refuses", () => {
    const loud = { ...decision, reason: "The drop is significant." };
    expect(() => report(loud, { format: "markdown" })).toThrow(ReportError);
  });
});
