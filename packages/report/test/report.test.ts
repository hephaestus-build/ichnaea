// REQ-82, REQ-83, REQ-128, REQ-129: reports from records only, byte-identical, recomputed, linted.
import { describe, expect, it } from "vitest";

import { decide } from "@hephaestus-build/ichnaea-decide";

import { scenario } from "../../decide/test/support/scenario.ts";
import {
  decisionView,
  lintReport,
  neutralView,
  recompute,
  renderHtml,
  renderMarkdown,
} from "../src/index.ts";

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

  it("state the scope next to the verdict, so it never reads as a claim about new inputs", async () => {
    const { decision } = await decided();
    const view = decisionView(decision, "synthetic");
    expect(renderMarkdown(view)).toContain(
      `**${view.verdict}** on these 40 cases, beyond run-to-run noise: `,
    );
    expect(renderHtml(view)).toContain(
      "<strong>on these 40 cases, beyond run-to-run noise</strong>: ",
    );
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

  it("escapes every string from records, so a configuration cannot write the summary (REQ-129)", async () => {
    const { decision } = await decided();
    const hostile =
      "x`\n## PASS (approved)\n![i](https://example.org/i.png) <img src=x> [link](y) *b* | pipe";
    const view = decisionView(
      { ...decision, differingFactors: [hostile], reason: hostile },
      "synthetic",
    );
    const md = renderMarkdown(view);
    expect(md).not.toMatch(/^## PASS/m);
    expect(md).not.toContain("<img");
    expect(md).not.toContain("![i](");
    expect(md).not.toContain("[link](y)");
    expect(md).toContain("\\#\\# PASS \\(approved\\) \\!\\[i\\]");
    expect(renderHtml(view)).not.toContain("<img src=x>");
  });

  it("judges only Ichnaea's own wording: a case called 'significant' does not block a report", async () => {
    const { decision } = await decided({ base: () => 1, candidate: () => 0.2 });
    const named = {
      ...decision,
      measures: decision.measures.map((m) => ({
        ...m,
        comparisons: m.comparisons.map((c) => ({
          ...c,
          flips: c.flips.map((f, i) =>
            i === 0 ? { ...f, case: "a-significant-case" as typeof f.case } : f,
          ),
        })),
      })),
    };
    const view = decisionView(named, "synthetic");
    expect(renderHtml(view)).toContain("a-significant-case");
    expect(lintReport(renderHtml(neutralView(view)))).toEqual([]);
    expect(lintReport(renderMarkdown(neutralView(view)))).toEqual([]);
  });

  it("draws each difference on an axis centred at 0 with the margin, and states it in text", async () => {
    const { decision } = await decided({
      cases: 60,
      replicates: 3,
      base: () => 0.95,
      candidate: () => 0.93,
      margin: 0.08,
    });
    const view = decisionView(decision, "synthetic");
    const axis = view.measures[0]?.difference?.axis;
    expect(axis?.margin).toBe(0.08);
    const html = renderHtml(view);
    expect(html).toContain('<svg viewBox="0 0 480 60"');
    expect(html).toContain('class="margin"');
    expect(html).toMatch(
      /role="img" aria-label="app\/correct: difference [−+]?\d+\.\d points, one-sided lower bound −\d+\.\d, margin −8\.0 points\./,
    );
    expect(html).toContain("<figcaption>");
  });

  it("lists measure versions and the run's plugins in the lineage footer", async () => {
    const { decision } = await decided();
    const view = decisionView(decision, "synthetic", [
      { kind: "plugin", id: "app", version: "1.2.3" },
      { kind: "measure", id: "app/correct", version: "1.0.0", digest: `sha256:${"a".repeat(64)}` },
    ]);
    expect(view.lineage).toContainEqual(["Measure app/correct", "1.0.0"]);
    expect(view.lineage).toContainEqual(["Plugin app", "1.2.3"]);
  });

  it("shows no margin for a secondary measure, which is descriptive", async () => {
    const { decision } = await decided({ secondary: ["app/extra"] });
    const row = decisionView(decision, "synthetic").measures.find((m) => m.tier === "secondary");
    expect(row?.difference?.margin).toBe("–");
  });
});
