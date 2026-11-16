// The mutant script is only worth running if each mutant still changes the code it names, so this
// test fails when a refactor moves an anchor.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { editsOf, MUTANTS, mutate } from "../scripts/mutants.ts";

const root = join(import.meta.dirname, "..");

describe("mutants", () => {
  it("have distinct ids", () => {
    const ids = MUTANTS.map((m) => m.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it.each(MUTANTS.map((m) => [m.id, m] as const))(
    "%s: every anchor occurs exactly once and the edit changes the file",
    (_, m) => {
      const original = readFileSync(join(root, m.file), "utf8");
      let rest = original;
      for (const { from } of editsOf(m)) {
        expect(rest.split(from).length - 1, `anchor ${JSON.stringify(from.slice(0, 60))}`).toBe(1);
        rest = rest.replace(from, "");
      }
      const mutated = mutate(original, m);
      expect("text" in mutated && mutated.text !== original).toBe(true);
    },
  );

  it("reports the anchor that is missing", () => {
    expect(
      mutate("a b", { id: "x", file: "f", from: "a", to: "c", also: [{ from: "z", to: "" }] }),
    ).toEqual({ missing: "z" });
  });
});
