import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { findPrivateReferences, findViolations } from "./check-purity.ts";

describe("framework purity check", () => {
  it.each([
    ["an application name", 'const target = "Hephaestus";'],
    ["an application concept", "// counts the practice review stops"],
    ["an application path", 'run("./gradlew test")'],
  ])("fails on %s", (_, line) => {
    expect(findViolations([{ path: "packages/x/src/a.ts", text: line }])).toHaveLength(1);
  });

  it("allows the npm scope", () => {
    expect(
      findViolations([{ path: "p.json", text: '"@hephaestus-build/ichnaea-contracts"' }]),
    ).toEqual([]);
  });
});

// The samples are assembled from parts so that this file does not contain a private reference.
const DN = ["D", "N"].join("");
const DC = ["D", "C"].join("");
const decision = (prefix: string, n: number): string => `${prefix}-${n}`;
const reviewFile = (name: string): string => `${name}-${"review"}.md`;

const scan = (text: string): string[] =>
  findPrivateReferences([{ path: "packages/x/src/a.ts", text }]);

describe("private design record check", () => {
  it.each([
    ["a decision number", `// see ${decision(DN, 7)}`],
    ["a decision number in parentheses", `it("keeps identities (${decision(DN, 12)})", ...)`],
    ["a design-change number", `// ruled in ${decision(DC, 3)}`],
    ["a review file name", `// tests added for ${reviewFile("M2-contracts")}`],
    ["a review file name in upper case", `see ${reviewFile("M2").toUpperCase()}`],
    ["a review label", `// Tests added for the ${"(independent"} ${"review)"}`],
  ])("fails on %s", (_, line) => {
    expect(scan(line)).toHaveLength(1);
  });

  it("reports the file and the line", () => {
    const [finding] = findPrivateReferences([
      { path: "docs/a.md", text: `fine\nsee ${decision(DN, 2)} here` },
    ]);
    expect(finding).toMatch(/^docs\/a\.md:2: a private decision number: see /);
  });

  it.each([
    [
      "a public decision record",
      "Decision 0002 gives the reasons (docs/decisions/0002-case-digest-content.md).",
    ],
    ["a requirement number", "// REQ-10: changing one case changes the digest"],
    [
      "words near the patterns",
      "A code review is not a record. A review of a pull request, a DNS record, a DCT table (D-3).",
    ],
    ["a letter before the prefix", `${["AD", "N-4"].join("")} ${["AD", "C-4"].join("")}`],
    ["a file that is not a review", "see review.md and reviews.md and a-reviewer.md"],
  ])("allows %s", (_, line) => {
    expect(scan(line)).toEqual([]);
  });

  it("finds nothing in its own files, so it needs no exclusion", () => {
    const files = ["check-purity.ts", "check-purity.test.ts"].map((name) => ({
      path: `scripts/${name}`,
      text: readFileSync(join(import.meta.dirname, name), "utf8"),
    }));
    expect(findPrivateReferences(files)).toEqual([]);
  });
});

describe("the purity command", () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  /** Runs the command in a new git repository that holds the given files, tracked or not. */
  function run(
    files: Record<string, string>,
    track: boolean,
  ): { status: number | null; stderr: string } {
    const root = mkdtempSync(join(tmpdir(), "purity-"));
    roots.push(root);
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    if (track) execFileSync("git", ["add", "."], { cwd: root });
    const command = join(import.meta.dirname, "check-purity.ts");
    const { status, stderr } = spawnSync("node", [command], { cwd: root, encoding: "utf8" });
    return { status, stderr };
  }

  it("passes a repository without a private reference", () => {
    expect(run({ "docs/a.md": "See decision 0002.\n", "src/a.yml": "a: 1\n" }, true).status).toBe(
      0,
    );
  });

  it.each([
    ["a markdown file", "docs/a.md", `Ruled in ${decision(DN, 6)}.`],
    ["a workflow file", ".github/workflows/ci.yml", `# ${reviewFile("M2")}`],
    ["a package script", "packages/x/scripts/a.ts", `// ${decision(DC, 2)}`],
    ["a file with no known extension", "LICENSE-notes", `${decision(DN, 1)}`],
  ])("fails when %s cites one, tracked or not", (_, path, text) => {
    for (const track of [true, false]) {
      const { status, stderr } = run({ [path]: `${text}\n` }, track);
      expect(status).toBe(1);
      expect(stderr).toContain(`${path}:1:`);
    }
  });
});
