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

/**
 * Lints `packages/ichnaea/<path>`, a file that imports `specifier` (with `import()` when `dynamic`),
 * and returns the errors.
 */
function lint(path: string, specifier: string, dynamic = false): string[] {
  const root = mkdtempSync(join(tmpdir(), "ichnaea-boundaries-"));
  roots.push(root);
  copyFileSync(join(repository, ".oxlintrc.json"), join(root, ".oxlintrc.json"));
  const file = join(root, "packages", "ichnaea", path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    dynamic
      ? `export const y: unknown = await import("${specifier}");\n`
      : `import { x } from "${specifier}";\n\nexport const y: unknown = x;\n`,
  );
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

const BARREL = "imports the file that defines what it uses, never an index.ts barrel";
const SELF = "imports its files by path, never the package by its name";

describe("the boundaries between the areas of the package", () => {
  it.each([
    ["src/stats/a.ts", "../contracts/primitives.ts", "src/stats imports only its own modules"],
    ["src/stats/a.ts", "zod", "src/stats imports only its own modules"],
    ["src/stats/a.ts", "node:fs", "src/stats imports only its own modules"],
    [
      "src/contracts/a.ts",
      "../core/store.ts",
      "src/contracts imports only its own modules and zod",
    ],
    ["src/contracts/a.ts", "../index.ts", "src/contracts imports only its own modules and zod"],
    ["src/contracts/a.ts", "node:crypto", "src/contracts imports only its own modules and zod"],
    ["src/contracts/records/a.ts", "../../stats/rng.ts", "src/contracts imports only"],
    ["src/contracts/records/a.ts", "ajv", "src/contracts imports only its own modules and zod"],
    ["src/core/a.ts", "../stats/rng.ts", "src/core calls the planner"],
    ["src/plan/a.ts", "../core/store.ts", "src/plan imports only"],
    ["src/plan/a.ts", "node:fs", "src/plan imports only"],
    ["src/decide/a.ts", "../core/store.ts", "src/decide imports only"],
    ["src/decide/a.ts", "@tumaet/ichnaea/stats", "src/decide imports only"],
    ["src/report/a.ts", "@tumaet/ichnaea", "src/report imports only"],
    ["src/decide/admit.ts", "node:fs", "src/decide imports only"],
    ["src/report/a.ts", "node:fs", "src/report imports only"],
    ["src/decide/a.ts", "../report/report.ts", "src/decide imports only"],
    ["src/decide/a.ts", "../index.ts", "src/decide imports only"],
    ["src/report/a.ts", "../stats/rng.ts", "src/report imports only"],
    ["src/calibration/a.ts", "../contracts/primitives.ts", "src/calibration imports only"],
    ["src/calibration/a.ts", "../decide/decide.ts", "src/calibration imports only"],
    ["src/calibration/a.ts", "node:fs", "src/calibration imports only"],
  ])("refuses an import in %s of %s", (path, specifier, message) => {
    const errors = lint(path, specifier);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(message);
  });

  it.each([
    ["src/stats/a.ts", "./index.ts"],
    ["src/contracts/a.ts", "./index.ts"],
    ["src/contracts/records/a.ts", "../index.ts"],
    ["src/core/a.ts", "../contracts/index.ts"],
    ["src/core/a.ts", "./index.ts"],
    ["src/decide/a.ts", "../stats/index.ts"],
    ["src/decide/a.ts", "../contracts/index.ts"],
    ["src/decide/a.ts", "../core/index.ts"],
    ["src/report/a.ts", "../decide/index.ts"],
    ["src/report/a.ts", "../contracts/index.ts"],
    ["src/calibration/a.ts", "../stats/index.ts"],
    ["src/calibration/a.ts", "./index.ts"],
    ["scripts/stats/a.ts", "../../src/stats/index.ts"],
    ["scripts/stats/a.ts", "../../src/calibration/index.ts"],
    ["test/stats/support/a.ts", "../../../src/stats/index.ts"],
  ])("refuses an import in %s of the barrel %s", (path, specifier) => {
    const errors = lint(path, specifier);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(BARREL);
  });

  it.each([
    ["src/decide/a.ts", "../stats/index.ts"],
    ["scripts/stats/a.ts", "../../src/stats/index.ts"],
  ])("refuses a dynamic import in %s of the barrel %s", (path, specifier) => {
    const errors = lint(path, specifier, true);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(BARREL);
  });

  it.each([
    ["src/core/a.ts", "@tumaet/ichnaea/contracts"],
    ["scripts/stats/a.ts", "@tumaet/ichnaea/stats"],
    ["test/stats/support/a.ts", "@tumaet/ichnaea/stats"],
  ])("refuses an import in %s of the package itself, %s", (path, specifier) => {
    const errors = lint(path, specifier);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(SELF);
  });

  it.each([
    ["src/stats/a.ts", "./compare.ts"],
    ["src/contracts/a.ts", "./primitives.ts"],
    ["src/contracts/a.ts", "zod"],
    ["src/contracts/records/a.ts", "../primitives.ts"],
    ["src/contracts/records/a.ts", "./case.ts"],
    ["src/core/a.ts", "../contracts/primitives.ts"],
    ["src/core/a.ts", "../contracts/records/plan.ts"],
    ["src/core/a.ts", "node:fs/promises"],
    ["src/decide/a.ts", "../stats/compare.ts"],
    ["src/core/a.ts", "../decide/decide.ts"],
    ["src/core/a.ts", "../report/report.ts"],
    ["src/plan/a.ts", "../stats/power.ts"],
    ["src/decide/a.ts", "../plan/power.ts"],
    ["src/report/a.ts", "../decide/decide.ts"],
    ["src/calibration/a.ts", "../stats/rng.ts"],
    ["src/calibration/a.ts", "./engine.ts"],
    ["src/index.ts", "./report/index.ts"],
    ["scripts/stats/a.ts", "../../src/stats/rng.ts"],
    ["scripts/stats/a.ts", "./provenance.ts"],
    ["test/stats/support/a.ts", "../../../src/stats/rng.ts"],
  ])("allows an import in %s of %s", (path, specifier) => {
    expect(lint(path, specifier)).toEqual([]);
  });
});
