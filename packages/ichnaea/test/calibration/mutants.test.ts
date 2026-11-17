// The mutant script is only worth running if each mutant still changes the code it names, so this
// test fails when a refactor moves an anchor. It sits in the `mutants` project, which no mutated run
// executes: its anchor check would fail under every mutant.
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CANARY, CONTROL, MUTANTS } from "../../scripts/calibration/mutants.ts";
import { anchorProblems } from "../../scripts/stats/mutants.ts";

const root = join(import.meta.dirname, "..", "..");

describe("the calibration mutants", () => {
  it("have distinct ids", () => {
    const ids = MUTANTS.map((m) => m.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it("have every anchor exactly once in its file, the controls' included", () => {
    expect(anchorProblems([CANARY, CONTROL, ...MUTANTS], root)).toEqual([]);
  });
});
