// The checks of a suite that its schema cannot express. `ichnaea lock` refuses a suite with any of
// them, each by a named reason.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { suiteProblems, SuiteV2 } from "../../src/contracts/index.ts";

type Rec = Record<string, unknown>;
const suite = (): Rec =>
  structuredClone(
    JSON.parse(
      readFileSync(
        join(import.meta.dirname, "..", "..", "fixtures", "valid", "suite.2.json"),
        "utf8",
      ),
    ) as Rec,
  );
const problems = (s: Rec) => suiteProblems(SuiteV2.parse(s));
const policy = (s: Rec): Rec => s["policy"] as Rec;

describe("the valid suite fixtures", () => {
  it("break no rule that lock checks", () => {
    const fixtures = join(import.meta.dirname, "..", "..", "fixtures");
    const extra = join(fixtures, "valid-extra", "suite.2");
    for (const file of [
      join(fixtures, "valid", "suite.2.json"),
      ...readdirSync(extra).map((f) => join(extra, f)),
    ])
      expect(suiteProblems(SuiteV2.parse(JSON.parse(readFileSync(file, "utf8"))))).toEqual([]);
  });
});

describe("a suite's fidelity margins", () => {
  it("are complete in the valid fixture, which has no attribute block", () => {
    expect(problems(suite())).toEqual([]);
  });

  it("let a primary measure default to half its registered limit", () => {
    const s = suite();
    policy(s)["secondary"] = [];
    s["attribute"] = { fidelityMargin: {} };
    expect(problems(s)).toEqual([]);
  });

  it("refuse an attributed secondary measure without an entry: it has no limit to halve", () => {
    const s = suite();
    s["measures"] = {
      ...(s["measures"] as Rec),
      "answer-length": { type: "score", scorer: { builtin: "length" } },
    };
    policy(s)["secondary"] = ["latency-ms", "answer-length"];
    s["attribute"] = { fidelityMargin: {} };
    expect(problems(s)).toEqual([
      {
        code: "FIDELITY_MARGIN_MISSING",
        path: "/attribute/fidelityMargin",
        message:
          "secondary measure 'answer-length' has no fidelity margin; only a primary measure has a registered limit to default to half of",
      },
    ]);
    s["attribute"] = { fidelityMargin: { "answer-length": 0.05 } };
    expect(problems(s)).toEqual([]);
  });
});

/** The valid suite with a level measure `completeness` of these members. */
const withLevel = (level: Rec): Rec => {
  const s = suite();
  s["measures"] = {
    ...(s["measures"] as Rec),
    completeness: { type: "level", scorer: { builtin: "rubric" }, ...level },
  };
  return s;
};
const codes = (level: Rec) => problems(withLevel(level)).map((p) => [p.code, p.path]);

describe("a level measure", () => {
  it("passes with ascending levels, a cut above the lowest and anchors on its levels", () => {
    expect(
      codes({ levels: [1, 2, 3, 4, 5], anchors: { "1": "none", "5": "all" }, spacing: "equal" }),
    ).toEqual([]);
    expect(
      codes({ levels: [0, 0.5, 1], anchors: { "0.5": "half" }, spacing: { cut: 0.5 } }),
    ).toEqual([]);
  });

  it("refuses levels that are not strictly ascending, so no level appears twice", () => {
    for (const levels of [
      [0, 2, 1],
      [0, 1, 1, 2],
    ])
      expect(problems(withLevel({ levels, spacing: "equal" }))).toEqual([
        {
          code: "LEVELS_NOT_ASCENDING",
          path: "/measures/completeness/levels",
          message: `measure 'completeness' lists levels ${levels.join(", ")}; they must be strictly ascending`,
        },
      ]);
  });

  it("refuses a cut that is not one of its levels", () => {
    expect(problems(withLevel({ levels: [0, 1, 2, 3], spacing: { cut: 1.5 } }))).toEqual([
      {
        code: "LEVEL_CUT_NOT_A_LEVEL",
        path: "/measures/completeness/spacing/cut",
        message: "measure 'completeness' cuts at 1.5, which is not one of its levels 0, 1, 2, 3",
      },
    ]);
  });

  it("refuses a cut at the lowest level, which would make every trial a success", () => {
    expect(problems(withLevel({ levels: [1, 2, 3], spacing: { cut: 1 } }))).toEqual([
      {
        code: "LEVEL_CUT_AT_LOWEST",
        path: "/measures/completeness/spacing/cut",
        message:
          "measure 'completeness' cuts at its lowest level 1, so every trial would be a success",
      },
    ]);
  });

  it("refuses an anchor that is not one of its levels, as JSON writes the number", () => {
    // JavaScript lists an integer key first, whatever order the file wrote.
    expect(
      problems(withLevel({ levels: [0, 1, 2], anchors: { "1.0": "partly", "3": "beyond" } })),
    ).toEqual([
      {
        code: "LEVEL_ANCHOR_NOT_A_LEVEL",
        path: "/measures/completeness/anchors/3",
        message: "measure 'completeness' anchors '3', which is not one of its levels 0, 1, 2",
      },
      {
        code: "LEVEL_ANCHOR_NOT_A_LEVEL",
        path: "/measures/completeness/anchors/1.0",
        message: "measure 'completeness' anchors '1.0', which is not one of its levels 0, 1, 2",
      },
    ]);
  });
});
