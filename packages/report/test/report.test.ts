// REQ-82, REQ-83, REQ-128, REQ-129: reports from records only, byte-identical, recomputed, linted.
import { describe, expect, it } from "vitest";

import { decide, FLOOR_NOT_SET_REASON } from "@hephaestus-build/ichnaea-decide";

import { decideFloorSet } from "../../decide/test/support/floor-set.ts";
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

  it("an estimate-only decision says so, and shows every difference with its interval (REQ-27)", async () => {
    const { decision } = await decided({ replicates: 1 });
    const view = decisionView(decision, "synthetic");
    const md = renderMarkdown(view);
    expect(md).toContain("**ESTIMATE-ONLY** estimates on these 40 cases, without a verdict: ");
    expect(md).not.toMatch(/beyond run-to-run noise/);
    expect(view.measures[0]?.difference?.bound).toMatch(/^≥ [+−]?\d+\.\d pts \(not validated\)$/);
    expect(lintReport(md)).toEqual([]);
    expect(lintReport(renderHtml(view))).toEqual([]);
  });

  it("a secondary measure shows its difference with an interval", async () => {
    const { decision } = await decided({ secondary: ["app/extra"] });
    const md = renderMarkdown(decisionView(decision, "synthetic"));
    const row = md.split("\n").find((l) => l.startsWith("| app/extra"));
    expect(row).toMatch(/\| [+−]?\d+\.\d pts \| ≥ [+−]?\d+\.\d pts \(not validated\) \| – \|$/);
  });

  it("the lint finds a rate or a difference without its interval, in Markdown and HTML", async () => {
    const md =
      "| Measure | Verdict | Arm | Rate | 95% interval | n | Missing | Difference | Bound | Margin |\n|---|---|---|---|---|---|---|---|---|---|\n| m | PASS | base | 97.0% |  | 3 of 3 | 0 | +1.0 pts |  | −10.0 pts |\n<details><summary>Lineage</summary>";
    expect(lintReport(md)).toEqual([
      "an estimate without its interval: a rate (97.0%) without its interval",
    ]);
    const { decision } = await decided();
    const html = renderHtml(decisionView(decision, "synthetic")).replace(
      /(data-col="bound"[^>]*>)[^<]*</,
      "$1<",
    );
    expect(lintReport(html)).toEqual([
      expect.stringMatching(
        /^an estimate without its interval: a difference \([+−]?\d+\.\d pts\) without its bound$/,
      ),
    ]);
  });

  it("states why the sensitivity analysis ran, what it imputes, and shows both results", async () => {
    // Both arms miss one trial: equal counts, so the analysis still runs.
    const { decision } = await decided({
      outcome: (t) =>
        t.case === "case-001" && t.replicate === 0 ? "infrastructure_failure" : undefined,
    });
    const view = decisionView(decision, "synthetic");
    expect(view.missingness).toMatch(
      /^base: 1 of 80 trials missing; candidate: 1 of 80 trials missing\. A primary measure misses trials, so each verdict was decided again with the missing trials imputed against it: for non-inferiority, missing candidate trials fail and missing base trials pass; for regression, the reverse\./,
    );
    expect(view.sensitivity.map((r) => r.imputation)).toEqual([
      "missing candidate trials fail, missing base trials pass",
      "missing candidate trials pass, missing base trials fail",
    ]);
    const md = renderMarkdown(view);
    expect(md).toContain(
      "| Measure | Imputation | Difference | Bound | Verdict | Changes the verdict |",
    );
    expect(lintReport(md)).toEqual([]);
    const none = decisionView((await decided()).decision, "synthetic");
    expect(none.missingness).toMatch(
      /No primary measure misses a trial in either arm, so no sensitivity analysis ran\.$/,
    );
  });

  it("the n column counts available trials of the planned ones", async () => {
    const { decision } = await decided({
      outcome: (t) =>
        t.arm === "candidate" && t.case === "case-001" && t.replicate === 0 ? "not_run" : undefined,
    });
    const arms = decisionView(decision, "synthetic").measures[0]?.arms;
    expect(arms?.map((a) => a.n)).toEqual(["80 of 80", "79 of 80"]);
  });

  it("shows the planning and the run-time power statement, and why an entry was not computed", async () => {
    const { decision } = await decided({ maxCalls: 1 });
    const planning = {
      computed: true as const,
      measure: decision.measures[0]?.measure as (typeof decision.power.run)[number]["measure"],
      applicableCases: 40,
      replicates: 2,
      margin: 0.1,
      mde: 0.05,
      floor: 0.05,
      assumption: "planning: no noise",
      decidable: true,
    };
    const view = decisionView(
      { ...decision, power: { ...decision.power, planning: [planning] } },
      "synthetic",
    );
    expect(view.power.map((p) => [p.statement, p.mde, p.reach, p.assumption])).toEqual([
      ["planning", "5.0 pts", "yes", "planning: no noise"],
      ["this run", "not computed", "unknown", "run invalid"],
    ]);
    expect(renderMarkdown(view)).toContain(
      "| this run | app/correct | 40 | 2 | – | not computed | 10.0 pts | unknown | run invalid |",
    );
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

  it("labels a bound 'not validated' unless the non-inferiority result is validated (decision 0015)", async () => {
    const stable = { cases: 60, replicates: 3, base: () => 0.97, candidate: () => 0.97 } as const;
    const s = await scenario(stable);
    const unset = await decide({ ...s, decidedAt: "2026-11-15T12:00:00Z", ichnaea: "0.0.0" });
    // The regression result is validated, and never vouches for the interval.
    expect(unset.measures[0]?.comparisons[0]?.regression.validated).toBe(true);
    expect(unset.measures[0]?.comparisons[0]?.nonInferiority.validated).toBe(false);
    const view = decisionView(unset, "synthetic");
    expect(view.measures[0]?.difference?.bound).toMatch(/^≥ [+−]?\d+\.\d pts \(not validated\)$/);
    const html = renderHtml(view);
    expect(html).toMatch(/data-col="bound" data-validated="false"[^>]*>≥ [^<]* \(not validated\)</);
    expect(html).toContain(
      "Non-inferiority needs the bound to the right of the margin. The bound is not validated.",
    );
    expect(lintReport(html)).toEqual([]);
    expect(lintReport(renderMarkdown(view))).toEqual([]);
    const set = decisionView(await decideFloorSet(s), "synthetic");
    expect(set.verdict).toBe("PASS");
    expect(set.measures[0]?.difference?.bound).toMatch(/^≥ [+−]?\d+\.\d pts$/);
    expect(renderHtml(set)).not.toContain("not validated");
  });

  it("labels each sensitivity bound by its own non-inferiority result", async () => {
    const { decision } = await decided({
      outcome: (t) =>
        t.case === "case-001" && t.replicate === 0 ? "infrastructure_failure" : undefined,
    });
    const view = decisionView(decision, "synthetic");
    expect(view.sensitivity).toHaveLength(2);
    for (const row of view.sensitivity) {
      expect(row.validated).toBe(false);
      expect(row.bound).toMatch(/ \(not validated\)$/);
    }
  });

  it("the lint finds an HTML bound marked not validated without its label", async () => {
    const { decision } = await decided();
    const html = renderHtml(decisionView(decision, "synthetic")).replace(" (not validated)<", "<");
    expect(lintReport(html)).toEqual([
      expect.stringMatching(
        /^an estimate without its interval: a bound \(≥ [^)]*\) that is not validated, without its label$/,
      ),
    ]);
  });

  it("says in plain words why an unchanged candidate is INCONCLUSIVE while the floor is not set", async () => {
    const s = await scenario({ cases: 60, replicates: 3, base: () => 0.97, candidate: () => 0.97 });
    const decision = await decide({ ...s, decidedAt: "2026-11-15T12:00:00Z", ichnaea: "0.0.0" });
    const view = decisionView(decision, "synthetic");
    expect(renderMarkdown(view)).toContain(
      `**INCONCLUSIVE** on these 60 cases, beyond run-to-run noise: ${FLOOR_NOT_SET_REASON}`,
    );
    expect(renderHtml(view)).toContain(FLOOR_NOT_SET_REASON);
  });

  it("shows no margin for a secondary measure, which is descriptive", async () => {
    const { decision } = await decided({ secondary: ["app/extra"] });
    const row = decisionView(decision, "synthetic").measures.find((m) => m.tier === "secondary");
    expect(row?.difference?.margin).toBe("–");
  });
});
