// The boundaries between the areas of the package are lint rules (.oxlintrc.json). These tests run
// the linter with the repository's configuration on files written into a scratch copy of the
// package's layout, so that a rule which stops matching fails here.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

const repository = join(import.meta.dirname, "..");
const OXLINT = join(repository, "node_modules", ".bin", "oxlint");
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Lints one file of the package, `src/<path>`, that imports `specifier`, and returns the errors. */
function lint(path: string, specifier: string): string[] {
  const root = mkdtempSync(join(tmpdir(), "ichnaea-boundaries-"));
  roots.push(root);
  copyFileSync(join(repository, ".oxlintrc.json"), join(root, ".oxlintrc.json"));
  const file = join(root, "packages", "ichnaea", "src", path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `import { x } from "${specifier}";\n\nexport const y: unknown = x;\n`);
  // JSON output, because oxlint picks another text format on GitHub Actions.
  const { status, stdout, stderr } = spawnSync(
    OXLINT,
    ["-c", ".oxlintrc.json", "--format", "json", "."],
    { cwd: root, encoding: "utf8" },
  );
  if (status === null || status > 1) throw new Error(`oxlint did not run: ${stderr}`);
  const { diagnostics } = JSON.parse(stdout) as {
    diagnostics: readonly { code: string; message: string; help?: string }[];
  };
  return diagnostics
    .filter((d) => d.code === "eslint(no-restricted-imports)")
    .map((d) => `${d.message} ${d.help ?? ""}`);
}

describe("the boundaries between the areas of the package", () => {
  it.each([
    ["stats/a.ts", "../contracts/index.ts", "src/stats imports only its own modules"],
    ["stats/a.ts", "zod", "src/stats imports only its own modules"],
    ["stats/a.ts", "node:fs", "src/stats imports only its own modules"],
    ["contracts/a.ts", "../core/index.ts", "src/contracts imports only its own modules and zod"],
    ["contracts/a.ts", "../index.ts", "src/contracts imports only its own modules and zod"],
    ["contracts/a.ts", "node:crypto", "src/contracts imports only its own modules and zod"],
    ["contracts/records/a.ts", "../../stats/index.ts", "src/contracts imports only"],
    ["contracts/records/a.ts", "ajv", "src/contracts imports only its own modules and zod"],
    ["core/a.ts", "../stats/index.ts", "src/core imports only src/contracts"],
    ["core/a.ts", "../decide/index.ts", "src/core imports only src/contracts"],
    ["core/a.ts", "../report/plugin.ts", "src/core imports only src/contracts"],
    ["decide/a.ts", "../report/index.ts", "src/decide imports only"],
    ["decide/a.ts", "../index.ts", "src/decide imports only"],
    ["report/a.ts", "../stats/index.ts", "src/report imports only"],
  ])("refuses an import in src/%s of %s", (path, specifier, message) => {
    const errors = lint(path, specifier);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(message);
  });

  it.each([
    ["stats/a.ts", "./compare.ts"],
    ["contracts/a.ts", "./primitives.ts"],
    ["contracts/a.ts", "zod"],
    ["contracts/records/a.ts", "../primitives.ts"],
    ["contracts/records/a.ts", "./case.ts"],
    ["core/a.ts", "../contracts/index.ts"],
    ["core/a.ts", "node:fs/promises"],
    ["decide/a.ts", "../stats/index.ts"],
    ["decide/a.ts", "../core/index.ts"],
    ["report/a.ts", "../decide/index.ts"],
    ["index.ts", "./report/index.ts"],
  ])("allows an import in src/%s of %s", (path, specifier) => {
    expect(lint(path, specifier)).toEqual([]);
  });
});
