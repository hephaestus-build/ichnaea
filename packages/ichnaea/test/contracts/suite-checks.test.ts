// The checks of a suite that its schema cannot express. `ichnaea lock` refuses a suite with any of
// them, each by a named reason.
import { readFileSync } from "node:fs";
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
