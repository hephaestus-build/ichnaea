import { REASON_CODES } from "@hephaestus-build/ichnaea/contracts";
import { describe, expect, it } from "vitest";

import { reasonSections, templateParts } from "../src/reference/reasons.ts";

describe("reason-code reference", () => {
  it("puts every code in exactly one section", () => {
    const listed = reasonSections().flatMap((section) =>
      section.reasons.map((reason) => reason.code),
    );
    expect(listed.toSorted()).toEqual([...REASON_CODES].toSorted());
  });

  it("files the INVALID codes under invalid runs, and REGRESSION_DETECTED under verdicts", () => {
    const sections = new Map(reasonSections().map((s) => [s.title, s.reasons.map((r) => r.code)]));
    expect(sections.get("Verdicts")).toContain("REGRESSION_DETECTED");
    expect(sections.get("Invalid runs")?.every((code) => code.startsWith("INVALID_"))).toBe(true);
  });

  it("marks the slots of a sentence template", () => {
    expect(templateParts("The {margin}-point margin.")).toEqual([
      { slot: false, text: "The " },
      { slot: true, text: "{margin}" },
      { slot: false, text: "-point margin." },
    ]);
  });
});
