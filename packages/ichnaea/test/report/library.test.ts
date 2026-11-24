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
    expect(text).toContain("INCONCLUSIVE");
    expect(text).toContain("app/correct");
    expect(text).toContain("Lineage");
  });

  it("renders HTML, and the view model as JSON", () => {
    expect(report(decision, { format: "html", lineage: s.run.lineage })).toMatch(
      /^<!doctype html>/i,
    );
    const view = JSON.parse(report(decision, { format: "json" })) as Record<string, unknown>;
    expect(view).toMatchObject({ verdict: "INCONCLUSIVE", title: "Ichnaea decision: run run-1" });
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

  // The lint masks identifiers where the report inserts them, never inside numbers or prose.
  it("keeps intervals whole when an identifier is a word of their text", () => {
    const named = { ...decision, differingFactors: ["to"] };
    for (const format of ["markdown", "html"] as const) {
      const text = report(named, { format });
      expect(text).toMatch(/\d+\.\d% to \d+\.\d%/);
    }
  });

  it("still refuses forbidden prose when an identifier is the same word", () => {
    const loud = {
      ...decision,
      differingFactors: ["significant"],
      reason: "The drop is significant.",
    };
    expect(() => report(loud, { format: "markdown" })).toThrow(ReportError);
    expect(() => report(loud, { format: "html" })).toThrow(ReportError);
  });

  it("does not refuse a report for an identifier the decision quotes or the view inserts", () => {
    const gate = "app/significant";
    const named = {
      ...decision,
      gates: [{ gate, passed: false, failures: 1 }],
      reason: `Hard gate '${gate}' failed.`,
      differingFactors: ["significant"],
      arms: decision.arms.map((a) => ({ ...a, name: `significant-${a.name}` as typeof a.name })),
      missingness: {
        ...decision.missingness,
        byArm: decision.missingness.byArm.map((a) => ({ ...a, arm: `significant-${a.arm}` })),
      },
    } as typeof decision;
    for (const format of ["markdown", "html"] as const)
      expect(report(named, { format, suite: "significant" })).toContain(gate);
  });
});
