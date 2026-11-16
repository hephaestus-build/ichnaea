// The docs workflow, read as text: `docs build` can be a required check, so it runs on every pull
// request and always reports.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  join(import.meta.dirname, "..", ".github", "workflows", "docs.yml"),
  "utf8",
);
/** The `on:` block: from `on:` to the next key at the start of a line. */
const triggers = /\non:\n([\s\S]*?)\n(?=\S)/.exec(workflow)?.[1] ?? "";

describe("the docs workflow", () => {
  it("has no path filter on any trigger, so a required check always reports", () => {
    expect(triggers).toContain("pull_request");
    expect(triggers).not.toMatch(/paths(-ignore)?:/);
  });

  it("builds on every pull request: the docs build job is not skipped by a condition", () => {
    expect(workflow).toMatch(/\n {2}build:\n {4}name: docs build\n {4}runs-on:/);
  });
});
