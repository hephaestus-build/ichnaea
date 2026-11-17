import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { findChangesets, findPrivateReferences, findViolations } from "./check-purity.ts";

describe("framework purity check", () => {
  it.each([
    ["an application name", 'const target = "Hephaestus";'],
    ["an application concept", "// counts the practice review stops"],
    ["an application path", 'run("./gradlew test")'],
  ])("fails on %s", (_, line) => {
    expect(findViolations([{ path: "packages/x/src/a.ts", text: line }])).toHaveLength(1);
  });

  it.each([
    ["the npm scope", '"@hephaestus-build/ichnaea-contracts"'],
    ["a tarball name", "hephaestus-build-ichnaea-core-0.1.0.tgz"],
    ["the organisation in a URL", "https://github.com/hephaestus-build/ichnaea"],
  ])("allows %s", (_, line) => {
    expect(findViolations([{ path: "p.json", text: line }])).toEqual([]);
  });

  it.each(["hephaestus-builder", "hephaestus-build_x", "hephaestus-buildkit"])(
    "fails on a longer word that starts with the organisation name: %s",
    (word) => {
      expect(findViolations([{ path: "p.ts", text: word }])).toHaveLength(1);
    },
  );
});

// The samples are assembled from parts so that this file does not contain a private reference.
const concat = (...parts: string[]): string => parts.join("");
const DN = concat("D", "N");
const DC = concat("D", "C");
const decision = (prefix: string, n: number): string => `${prefix}-${n}`;
const reviewFile = (name: string): string => `${name}-${"review"}.md`;

const scan = (text: string): string[] =>
  findPrivateReferences([{ path: "packages/x/src/a.ts", text }]);

describe("private design record check", () => {
  it.each([
    ["a decision number", `// see ${decision(DN, 7)}`],
    ["a decision number in parentheses", `it("keeps identities (${decision(DN, 12)})", ...)`],
    ["a design-change number", `// ruled in ${decision(DC, 3)}`],
    ["a decision number that starts at zero", `// ${decision(DN, 0)}`],
    ["a lower case decision number", `// ${decision(DN, 8).toLowerCase()}`],
    ["a lower case design-change number", `// ${decision(DC, 9).toLowerCase()}`],
    ["a mixed case decision number", `// ${concat("D", "n", "-7")}`],
    ["a decision number with a space", `// ${DN} 7`],
    ["a decision number without a separator", `// ${DN}7`],
    ["a decision number without a separator that starts at zero", `// ${DN}0`],
    ["a decision number without a separator, full-width", `// ${DC}\uFF17`],
    ["a decision number with a non-breaking hyphen", `// ${DN}\u20117`],
    ["a decision number with an en dash", `// ${DN}\u20137`],
    ["a decision number with a minus sign", `// ${DN}\u22127`],
    ["a decision number with a full-width digit", `// ${DN}-\uFF17`],
    ["a quality-gate number", `// ${concat("Q", "G")}-12`],
    ["a lower case quality-gate number", `// ${concat("q", "g")}-12`],
    ["a finding number with L and R", `// ${concat("L", "R")}-53`],
    ["a finding number with S and N", `// ${concat("S", "N")}-30`],
    ["a round finding number", `// ${concat("M", "-R3-1")}`],
    ["a lower case round finding number", `// ${concat("m", "-R4-5")}`],
    ["a blocker finding number", `// ${concat("B", "-R1-2")}`],
    ["a review finding number", `// ${concat("R", "-M1")}`],
    ["a review file name", `// tests added for ${reviewFile("x")}`],
    ["a review file name in upper case", `see ${reviewFile("x").toUpperCase()}`],
    ["a review file name without the extension", `see ${concat("x1", "-notes-", "review")}`],
    ["a round review file name", `see ${concat("x2", "-review")}`],
    ["a review label", `// Tests added for the ${"(independent"} ${"review)"}`],
    ["a review label with two spaces", `// ${"(independent"}  ${"review)"}`],
    ["a review label without parentheses", `// ${"independent"} ${"review"} of the code`],
    ["a review label across a line break", `${"(independent"}\n${"review)"}`],
    ["a review label across a comment line break", `// ${"(independent"}\n// ${"review)"}`],
    ["the design log", `see ${concat("DESIGN", "-LOG", ".md")}`],
    ["the name of the workstream", `// ${concat("THE", "MIS")} ruled this`],
    ["the name of the workstream in lower case", `// ${concat("the", "mis")} ruled this`],
    ["a role name", `// ${"the"} ${"coordinator"} chose this`],
    ["a local path", `const root = "${concat("/Us", "ers/someone/work")}";`],
    ["a local workspace path", `see ${concat(".con", "text/x.txt")}`],
  ])("fails on %s", (_, line) => {
    expect(scan(line)).toHaveLength(1);
  });

  it("reports a path under the local workspace, with its parts", () => {
    const line = concat(".con", "text/", "the", "mis", "/reviews/x.md");
    expect(scan(line).length).toBeGreaterThanOrEqual(2);
  });

  it("reports a match across a line break on its first line", () => {
    const [finding] = scan(`fine\n// ${"(independent"}\n// ${"review)"}`);
    expect(finding).toMatch(
      /^packages\/x\/src\/a\.ts:2: a private review label: \/\/ \(independent$/,
    );
  });

  it("reports a record once per line and again on the next line", () => {
    expect(scan(`${decision(DN, 1)} and ${decision(DN, 2)}\n${decision(DN, 3)}`)).toHaveLength(2);
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
    ["a path to a decision record", "See docs/decisions/0004 for the reasons."],
    ["a requirement number", "// REQ-10: changing one case changes the digest"],
    ["a requirement number with two digits", "REQ-50 and REQ-148 stay public."],
    [
      "words near the patterns",
      "A code review is not a record. A review of a pull request, a DNS record, a DCT table (D-3).",
    ],
    ["a letter before the prefix", `${["AD", "N-4"].join("")} ${["AD", "C-4"].join("")}`],
    ["a letter before the number", `${["AD", "N7"].join("")} ${["AD", "C 7"].join("")}`],
    ["a file that is not a review", "see review.md and reviews.md and a-reviewer.md"],
    ["a review of code", "A code-review, a peer-review and a pre-merge-review each need a person."],
    ["independent reviewers", "Two independent reviewers read each case."],
    ["words that start like a prefix", "A DNSSEC zone, a LRU-2 cache, SNR-3 and QGIS-1."],
    ["a folder named context", "Put the files in context/ or in src/context/."],
    ["a base64 hash that contains a prefix", `integrity: sha512-ab+${DC}9xy/${DN}7zz==`],
    ["a path that is not a home folder", "Run /usr/Users and /opt/users/x."],
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

  it("fails on a changeset, which Ichnaea does not keep (decision 0019)", () => {
    const { status, stderr } = run({ ".changeset/a-change.md": "---\n---\nA change.\n" }, true);
    expect(status).toBe(1);
    expect(stderr).toContain(".changeset/a-change.md: a changeset");
  });

  it("passes a repository without a private reference", () => {
    expect(run({ "docs/a.md": "See decision 0002.\n", "src/a.yml": "a: 1\n" }, true).status).toBe(
      0,
    );
  });

  it.each([
    ["a markdown file", "docs/a.md", `Ruled in ${decision(DN, 6)}.`],
    ["a workflow file", ".github/workflows/ci.yml", `# ${reviewFile("x")}`],
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

describe("the changeset check", () => {
  it("names every file under .changeset/ and nothing else", () => {
    expect(
      findChangesets([
        ".changeset/a.md",
        ".changeset/config.json",
        "docs/changeset.md",
        "a/.changeset/x.md",
      ]),
    ).toEqual([
      ".changeset/a.md: a changeset, but the titles on main are the change log (decision 0019)",
      ".changeset/config.json: a changeset, but the titles on main are the change log (decision 0019)",
    ]);
  });
});

describe("the purity command in text mode", () => {
  const command = join(import.meta.dirname, "check-purity.ts");
  const cwd = mkdtempSync(join(tmpdir(), "purity-text-"));
  afterAll(() => rmSync(cwd, { recursive: true, force: true }));

  /** Runs the command outside a git repository, so that it cannot be checking files. */
  function runText(
    args: string[],
    { env = {}, input }: { env?: Record<string, string>; input?: string } = {},
  ): { status: number | null; stdout: string; stderr: string } {
    const { status, stdout, stderr } = spawnSync("node", [command, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, ...env },
      input,
    });
    return { status, stdout, stderr };
  }

  it("passes the text of an environment variable that cites no private record", () => {
    const { status, stdout } = runText(["--env", "PR_TITLE"], {
      env: { PR_TITLE: "fix(contracts): REQ-50 holds, see docs/decisions/0004" },
    });
    expect(status).toBe(0);
    expect(stdout).toContain("1 texts clean");
  });

  it("passes an empty variable, as a pull request without a body has", () => {
    expect(runText(["--env", "PR_BODY"], { env: { PR_BODY: "" } }).status).toBe(0);
  });

  it("does not check for application names, which a pull request may use", () => {
    const { status } = runText(["--env", "PR_TITLE"], {
      env: { PR_TITLE: "feat(core): an adapter for Hephaestus" },
    });
    expect(status).toBe(0);
  });

  it("fails when the title cites a private record, and names the variable", () => {
    const { status, stderr } = runText(["--env", "PR_TITLE"], {
      env: { PR_TITLE: `fix: ruled in ${decision(DN, 7)}` },
    });
    expect(status).toBe(1);
    expect(stderr).toContain("$PR_TITLE:1: a private decision number");
  });

  it("checks every named variable and gives the line in a multi-line body", () => {
    const { status, stderr } = runText(["--env", "PR_TITLE", "--env", "PR_BODY"], {
      env: { PR_TITLE: "fix: a clean title", PR_BODY: `Problem.\n\nSee ${reviewFile("x")}.` },
    });
    expect(status).toBe(1);
    expect(stderr).toContain("$PR_BODY:3: a private review file");
    expect(stderr).not.toContain("$PR_TITLE");
  });

  it("reads text from standard input", () => {
    expect(runText(["--stdin"], { input: "A clean message.\n" }).status).toBe(0);
    const { status, stderr } = runText(["--stdin"], { input: `see ${decision(DC, 4)}\n` });
    expect(status).toBe(1);
    expect(stderr).toContain("stdin:1: a private decision number");
  });

  it("does not treat an unset variable as clean text", () => {
    const { status, stderr } = runText(["--env", "PR_NOT_SET_HERE"]);
    expect(status).toBe(2);
    expect(stderr).toContain("PR_NOT_SET_HERE is not set");
  });

  it("rejects an option that it does not know", () => {
    expect(runText(["--file", "x"]).status).toBe(2);
  });
});
