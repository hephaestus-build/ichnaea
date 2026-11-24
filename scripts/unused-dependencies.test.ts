import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

it("the dependency check rejects a devDependency when nothing imports it", () => {
  const root = join(import.meta.dirname, "..");
  const manifest: { scripts: Record<string, string> } = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  const fixture = mkdtempSync(join(tmpdir(), "ichnaea-unused-dependency-"));
  try {
    symlinkSync(join(root, "node_modules"), join(fixture, "node_modules"), "junction");
    writeFileSync(
      join(fixture, "package.json"),
      JSON.stringify({
        private: true,
        scripts: { "check:dependencies": manifest.scripts["check:dependencies"] },
        devDependencies: { "fast-check": "*" },
      }),
    );
    const entry = join(fixture, "index.ts");
    writeFileSync(entry, "export const answer = 42;\n");
    const check = () =>
      spawnSync("pnpm", ["run", "check:dependencies"], { cwd: fixture, encoding: "utf8" });

    const unused = check();
    expect(unused.status).toBe(1);
    expect(unused.stdout + unused.stderr).toMatch(/Unused devDependencies[\s\S]*fast-check/u);

    writeFileSync(entry, 'import "fast-check";\n');
    const used = check();
    expect(used.status, used.stdout + used.stderr).toBe(0);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
