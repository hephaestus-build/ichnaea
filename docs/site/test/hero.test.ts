import { describe, expect, it } from "vitest";

import { changedCases, heroAlt, points, renderHero } from "../src/hero/render.ts";
import { broken, regressed } from "./fixtures/support-regressed.ts";

describe("hero figure", () => {
  it("writes points with a true minus sign and no trailing zero", () => {
    expect(points(-0.25)).toBe("−25");
    expect(points(-0.083)).toBe("−8.3");
    expect(points(0.1)).toBe("10");
    expect(points(0)).toBe("0");
  });

  it("finds the cases whose pass share changed", () => {
    expect(changedCases(regressed.cases).map((c) => c.id)).toEqual([...broken]);
  });

  it("draws every trial of both arms, filled for a pass and open for a failure", () => {
    const svg = renderHero(regressed, "light");
    const trials = svg.match(/<rect x="[^"]*" y="(105|129)"[^>]*>/g) ?? [];
    expect(trials).toHaveLength(72);
    expect(trials.filter((rect) => rect.includes('fill="none"'))).toHaveLength(9);
    expect(svg).toContain(">passed</text>");
    expect(svg).toContain(">failed</text>");
  });

  it("dashes and labels a bound that is not validated", () => {
    const svg = renderHero(regressed, "dark");
    expect(svg).toContain('stroke-dasharray="6 4"');
    expect(svg).toContain("−41 descriptive bound, not validated");
    expect(
      renderHero({ ...regressed, change: { ...regressed.change, validated: true } }, "dark"),
    ).not.toContain("not validated");
  });

  it("is an accessible image whose description states every number it shows", () => {
    const svg = renderHero(regressed, "light");
    expect(svg).toContain('role="img"');
    expect(svg).toContain('<title id="title">✗ Support answers · REGRESSION</title>');
    const alt = heroAlt(regressed);
    for (const fact of [
      "REGRESSION",
      "25 points",
      "100% → 75%",
      "12 cases",
      "3 trials",
      "support-03 (3 of 3 to 0 of 3)",
      "−41 points, not validated",
      "margin is 15 points",
      "CI policy: block",
    ])
      expect(alt).toContain(fact);
  });

  it("escapes text for XML", () => {
    expect(renderHero({ ...regressed, title: "a < b & c" }, "light")).toContain("a &lt; b &amp; c");
  });
});
