// REQ-82, REQ-83, REQ-128, REQ-129: reports from records only, byte-identical, recomputed, linted.
import { describe, expect, it } from "vitest";

import { decide } from "@hephaestus-build/ichnaea-decide";

import { scenario } from "../../decide/test/support/scenario.ts";
import { decisionView, lintReport, recompute, renderHtml, renderMarkdown } from "../src/index.ts";

async function decided(over: Partial<Parameters<typeof scenario>[0]> = {}) {
  const s = await scenario({
    cases: 40,
    replicates: 2,
    base: () => 0.9,
    candidate: () => 0.85,
    ...over,
  });
  const decision = await decide({ ...s, decidedAt: "2026-11-15T12:00:00Z", ichnaea: "0.0.0" });
  return { ...s, decision };
}

describe("reports", () => {
  it("render the same records to byte-identical output", async () => {
    const { decision } = await decided();
    const a = decisionView(decision, "synthetic");
    const b = decisionView(structuredClone(decision), "synthetic");
    expect(renderMarkdown(a)).toBe(renderMarkdown(b));
    expect(renderHtml(a)).toBe(renderHtml(b));
  });

  it("show the same numbers in the CI summary and the site, each with its interval and n", async () => {
    const { decision } = await decided();
    const view = decisionView(decision, "synthetic");
    const md = renderMarkdown(view);
    const html = renderHtml(view);
    for (const arm of view.measures[0]?.arms ?? []) {
      expect(md).toContain(arm.rate);
      expect(md).toContain(arm.interval.replaceAll("&", "&amp;"));
      expect(html).toContain(arm.rate);
      expect(html).toContain(arm.n);
    }
  });

  it("carry the verdict as text, a lineage footer, and no forbidden wording", async () => {
    const { decision } = await decided();
    const html = renderHtml(decisionView(decision, "synthetic"));
    expect(html).toContain(decision.verdict ?? "ESTIMATE-ONLY");
    expect(lintReport(html)).toEqual([]);
    expect(html).not.toContain("<script");
  });

  it("the lint catches forbidden wording and a missing lineage", () => {
    expect(lintReport("A significant improvement. Lineage")).toHaveLength(1);
    expect(lintReport("no footer here")).toEqual(["no lineage footer"]);
    expect(lintReport("Lineage: the data is anonymous")).toHaveLength(1);
  });

  it("the recompute check passes on stored records and fails when a record changed (REQ-83)", async () => {
    const records = await decided();
    expect((await recompute(records)).matches).toBe(true);
    const tampered = {
      ...records,
      values: records.values.map((v, i) =>
        i === 0
          ? { ...v, value: { type: "binary" as const, pass: !(v.value as { pass: boolean }).pass } }
          : v,
      ),
    };
    const result = await recompute(tampered as never);
    expect(result.matches).toBe(false);
    expect(result.differences).toContain("measures");
  });

  it("an estimate-only decision says so and claims no interval for differences", async () => {
    const { decision } = await decided({ replicates: 1 });
    const md = renderMarkdown(decisionView(decision, "synthetic"));
    expect(md).toContain("ESTIMATE-ONLY");
    expect(md).toContain("no interval (estimate-only)");
  });
});
