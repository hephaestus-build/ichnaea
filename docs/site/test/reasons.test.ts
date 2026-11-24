import { REASON_CODES } from "@tumaet/ichnaea/contracts";
import { describe, expect, it } from "vitest";

import { reasonSections, SLOT_NOTES, templateParts } from "../src/reference/reasons.ts";

describe("reason-code reference", () => {
  it("puts every code in exactly one section", () => {
    const listed = reasonSections().flatMap((section) =>
      section.reasons.map((reason) => reason.code),
    );
    expect(listed.toSorted()).toEqual([...REASON_CODES].toSorted());
  });

  it("files the INVALID codes under invalid runs, and the within-run drop code under verdicts", () => {
    const sections = new Map(reasonSections().map((s) => [s.title, s.reasons.map((r) => r.code)]));
    expect(sections.get("Verdicts")).toContain("DROP_IN_THESE_RUNS_ONLY");
    expect(sections.get("Invalid runs")?.every((code) => code.startsWith("INVALID_"))).toBe(true);
  });

  it("splits each reason's slots into its own parameters and the decision's context", () => {
    const reasons = reasonSections().flatMap((section) => section.reasons);
    const hard = reasons.find((reason) => reason.code === "HARD_CHECK_FAILED");
    expect(hard?.params).toEqual(["check", "failures", "checked"]);
    const pass = reasons.find((reason) => reason.code === "PASS");
    expect(pass?.params).toEqual([]);
    expect(pass?.context).toContain("cases");
  });

  it("explains that {arm} is a name and {side} is base or candidate", () => {
    expect(SLOT_NOTES.arm).toContain("name");
    expect(SLOT_NOTES.side).toBe("base or candidate");
  });

  it("marks the slots of a sentence template", () => {
    expect(templateParts("The {margin}-point margin.")).toEqual([
      { slot: false, text: "The " },
      { slot: true, text: "{margin}" },
      { slot: false, text: "-point margin." },
    ]);
  });
});
