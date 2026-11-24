import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

it("rejects an unknown requirement citation in a new test file and indexes a known ID", () => {
  const root = mkdtempSync(join(tmpdir(), "ichnaea-requirement-status-"));
  const known = `REQ-${"01"}`;
  const uncited = `REQ-${"02"}`;
  const unknown = `REQ-${"999"}`;
  const script = join(import.meta.dirname, "requirements-status.ts");
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });

  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    mkdirSync(join(root, "docs"));
    symlinkSync(join(root, "docs"), join(root, "docs-link"), "junction");
    writeFileSync(
      join(root, "docs", "requirements.md"),
      `| ${known} | A requirement. |\n| ${uncited} | Another requirement. |\n`,
    );
    const testFile = join(root, "decision.test.ts");
    const notes = join(root, "notes.txt");
    writeFileSync(testFile, `// ${unknown}\n`);
    writeFileSync(notes, `Another citation\n${unknown}\n`);

    const rejected = run("--check");
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain(`decision.test.ts:1: unknown requirement ID ${unknown}`);
    expect(rejected.stderr).toContain(`notes.txt:2: unknown requirement ID ${unknown}`);

    writeFileSync(testFile, `// ${known}\n`);
    writeFileSync(notes, `See ${known}.\n`);
    const accepted = run("--check");
    expect(accepted.status, accepted.stderr).toBe(0);

    const generated = run();
    expect(generated.status, generated.stderr).toBe(0);
    expect(generated.stdout).toContain(`| ${known} | Test cited | [decision.test.ts](`);
    expect(generated.stdout).toContain(`| ${uncited} | No citations | — | — |`);
    expect(generated.stdout).toContain("[notes.txt](");
    expect(generated.stdout).not.toContain("[docs/requirements.md](");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
