import { describe, expect, it } from "vitest";

import {
  changedCases,
  heroAlt,
  parseHeroCard,
  renderHero,
  tickLabel,
  wrap,
} from "../src/hero/render.ts";
import { broken, regressed, regressedJson } from "./fixtures/support-regressed.ts";

/** The visible text of an SVG: its title, description and text elements. */
const visibleText = (svg: string): string =>
  [...svg.matchAll(/<(title|desc|text)[^>]*>([^<]*)<\/\1>/g)].map((m) => m[2]).join("\n");

describe("hero figure", () => {
  it("labels axis ticks in points with a true minus sign", () => {
    expect(tickLabel(-0.3)).toBe("−30");
    expect(tickLabel(0.1)).toBe("10");
    expect(tickLabel(0)).toBe("0");
  });

  it("finds the cases whose pass share changed", () => {
    expect(changedCases(regressed.measures[0].cases).map((c) => c.case)).toEqual([...broken]);
  });

  it("draws each arm's counts, passes first, for every case", () => {
    const svg = renderHero(regressed, "light");
    const squares = svg.match(/<rect x="[^"]*" y="[^"]*" width="(?!11")[^>]*>/g) ?? [];
    expect(squares).toHaveLength(72);
    expect(squares.filter((rect) => rect.includes('fill="none"'))).toHaveLength(9);
    expect(svg).toContain(">passed</text>");
    expect(svg).toContain(">failed</text>");
  });

  it("labels numbers with the card's own text", () => {
    const svg = renderHero(regressed, "dark");
    expect(svg).toContain(">−25 points</text>");
    expect(svg).toContain("−41 points descriptive one-sided 95% bound, not validated");
  });

  it("dashes a bound that is not validated, and only that one", () => {
    expect(renderHero(regressed, "light")).toContain('stroke-dasharray="6 4"');
    const [measure] = regressed.measures;
    const bound = { ...measure.change.bound, validity: "validated" as const };
    const validated = {
      ...regressed,
      measures: [{ ...measure, change: { ...measure.change, bound } }] as const,
    };
    expect(renderHero(validated, "light")).not.toContain('stroke-dasharray="6 4"');
  });

  // Until lintCard lands (UX-CARDS L19), these check its two rules that the hero can break:
  // L5, the Regression card's limit sentence, and L2, the label of a bound that is not validated.
  it("keeps the limit sentence and the bound's label in the figure and the text alternative", () => {
    const svg = renderHero(regressed, "light");
    for (const text of [visibleText(svg), heroAlt(regressed)]) {
      expect(text).toContain("This does not establish that the loss exceeds the 15-point limit.");
      expect(text).toMatch(/descriptive one-sided 95% bound[^.]*not validated/i);
    }
    expect(heroAlt(regressed)).toContain(
      "The descriptive one-sided 95% bound is −41 points, not validated, against a margin of 15 points.",
    );
  });

  it("is an accessible image whose description states the strip", () => {
    const svg = renderHero(regressed, "light");
    expect(svg).toContain('role="img"');
    expect(svg).toContain('<title id="title">✗ Support answers · Regression</title>');
    expect(heroAlt(regressed)).toContain(
      "support-03 (3 of 3 passed in the base, 0 of 3 in the candidate)",
    );
    expect(heroAlt(regressed)).toContain(regressed.policy.line);
  });

  it("reads the card's fields, and refuses a card that lacks one", () => {
    expect(regressed.measures[0].margin.shown).toBe("15 points");
    expect(() => parseHeroCard({ ...(regressedJson as object), title: 7 })).toThrow(
      "card.json: title",
    );
    expect(() => parseHeroCard({ ...(regressedJson as object), measures: [] })).toThrow(
      "measures[0]",
    );
  });

  it("wraps a long sentence at spaces", () => {
    expect(wrap("aa bb cc dd", 5)).toEqual(["aa bb", "cc dd"]);
    const svg = renderHero(regressed, "light");
    expect(svg).toContain(
      ">This does not establish that the loss exceeds the 15-point limit. Until the limit check is validated,",
    );
  });

  it("escapes text for XML", () => {
    expect(renderHero({ ...regressed, title: "a < b & c" }, "light")).toContain("a &lt; b &amp; c");
  });
});
