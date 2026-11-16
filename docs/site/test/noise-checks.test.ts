import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const page = readFileSync(
  join(import.meta.dirname, "..", "src", "content", "docs", "explanation", "noise-checks.mdx"),
  "utf8",
);

describe("noise checks page", () => {
  // decide.ts waives the noise-check precondition for a plan whose two arms are one configuration,
  // and nothing else. Without the exception on the page, the first noise check looks impossible.
  it("states that a noise check's own plan cites no earlier noise checks", () => {
    expect(page).toContain("A noise check's own plan is the exception");
    expect(page).toContain("Its records must still pass the other checks of one trial per case.");
  });
});
