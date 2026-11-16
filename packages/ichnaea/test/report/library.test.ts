// report renders a decision as text: synchronous, from the decision record alone, and linted.
import { describe, expect, it } from "vitest";

import { compare } from "../../src/decide/index.ts";
import { report, ReportError } from "../../src/report/index.ts";
import { scenario } from "../decide/support/scenario.ts";

const s = await scenario({
  cases: 40,
  replicates: 2,
  base: () => 0.95,
  candidate: () => 0.5,
  opaque: true,
});
const decision = compare(s.plan, s, { decidedAt: "2026-11-16T13:00:00Z" });

describe("report", () => {
  it("renders Markdown with the verdict, the measures and the lineage", () => {
    const text = report(decision, { format: "markdown", suite: "support" });
    expect(text).toContain("Ichnaea decision: support");
    expect(text).toContain("REGRESSION");
    expect(text).toContain("app/correct");
    expect(text).toContain("Lineage");
  });

  it("renders HTML, and the view model as JSON", () => {
    expect(report(decision, { format: "html", lineage: s.run.lineage })).toMatch(
      /^<!doctype html>/i,
    );
    const view = JSON.parse(report(decision, { format: "json" })) as Record<string, unknown>;
    expect(view).toMatchObject({ verdict: "REGRESSION", title: "Ichnaea decision: run run-1" });
  });

  it("is synchronous and the same for the same decision", () => {
    const text = report(decision, { format: "markdown" });
    expect(text).not.toBeInstanceOf(Promise);
    expect(report(structuredClone(decision), { format: "markdown" })).toBe(text);
  });

  it("refuses to render a report the lint refuses", () => {
    const loud = { ...decision, reason: "The drop is significant." };
    expect(() => report(loud, { format: "markdown" })).toThrow(ReportError);
    expect(() => report(loud, { format: "html" })).toThrow(ReportError);
  });
});
