// The docs workflow, read as text: `docs build` must always report, so the workflow runs on every
// pull request and a first job decides whether to build (scripts/docs-changes.ts).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DOCS_PATHS, touchesDocs } from "./docs-changes.ts";

const root = join(import.meta.dirname, "..");
const workflow = readFileSync(join(root, ".github", "workflows", "docs.yml"), "utf8");
/** The `on:` block: from `on:` to the next key at the start of a line. */
const triggers = /\non:\n([\s\S]*?)\n(?=\S)/.exec(workflow)?.[1] ?? "";

describe("the docs workflow", () => {
  it("has no path filter on any trigger, so a required check always reports", () => {
    expect(triggers).toContain("pull_request");
    expect(triggers).not.toMatch(/paths(-ignore)?:/);
  });

  it("builds only when the changes job finds a docs change, so a skipped build counts as passed", () => {
    expect(workflow).toMatch(
      /\n {2}build:\n {4}name: docs build\n {4}needs: changes\n {4}if: needs\.changes\.outputs\.docs == 'true'\n/,
    );
    expect(workflow).toContain("node scripts/docs-changes.ts");
  });
});

describe("docs changes", () => {
  it.each([
    ["the library's sources", ["packages/ichnaea/src/stats/power.ts"], true],
    ["a docs page", ["docs/site/src/content/docs/index.mdx"], true],
    ["the lockfile", ["pnpm-lock.yaml"], true],
    ["the workflow itself", [".github/workflows/docs.yml"], true],
    ["only the README", ["README.md"], false],
    ["only library tests", ["packages/ichnaea/test/stats/power.test.ts"], false],
    ["a file whose name starts like a listed file", ["package.json.bak"], false],
    ["nothing", [], false],
  ])("%s: %s", (_, files, expected) => {
    expect(touchesDocs(files)).toBe(expected);
  });

  it("lists only paths that exist", () => {
    for (const path of DOCS_PATHS) expect(existsSync(join(root, path)), path).toBe(true);
  });
});
