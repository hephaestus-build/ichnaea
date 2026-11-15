// REQ-08: a target never receives a hidden reference or any field outside the input side.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { Case, caseForTarget } from "../src/index.ts";
import { arbitraryFor } from "./support/arbitrary.ts";

describe("target view of a case", () => {
  it("never carries references, slices, provenance, pool or validation", () => {
    fc.assert(
      fc.property(arbitraryFor(Case), (generated) => {
        const record = Case.parse({
          ...(generated as object),
          references: { gold: "HIDDEN-REFERENCE" },
        });
        const view = caseForTarget(record);
        expect(Object.keys(view).toSorted()).toEqual(
          expect.arrayContaining(["id", "input", "unit"]),
        );
        for (const key of Object.keys(view))
          expect(["id", "unit", "input", "turns", "fixtures"]).toContain(key);
        expect(JSON.stringify(view)).not.toContain("HIDDEN-REFERENCE");
      }),
      { seed: 20261115, numRuns: 200 },
    );
  });

  it("copies the input, so a target cannot change the case", () => {
    const record = Case.parse({
      ...(fc.sample(arbitraryFor(Case), { seed: 1, numRuns: 1 })[0] as object),
      input: { q: "a" },
    });
    const view = caseForTarget(record);
    (view.input as Record<string, unknown>)["q"] = "changed";
    expect(record.input["q"]).toBe("a");
  });
});
