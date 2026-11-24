import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const page = readFileSync(
  join(import.meta.dirname, "..", "src", "content", "docs", "explanation", "noise-checks.mdx"),
  "utf8",
);

describe("noise checks page", () => {
  it("describes an optional noise check and pilot", () => {
    expect(page).toContain("A noise check is optional.");
    expect(page).toContain("base-against-base run to the planner as a pilot");
  });
});
