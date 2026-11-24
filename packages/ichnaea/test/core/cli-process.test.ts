import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const cwd = mkdtempSync(join(tmpdir(), "ichnaea-cli-"));
const bin = fileURLToPath(new URL("../../src/core/bin.ts", import.meta.url));
const run = (...argv: string[]) =>
  spawnSync(process.execPath, [bin, ...argv], { cwd, encoding: "utf8" });
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

describe("the CLI's process streams", () => {
  it("keeps schema JSON on stdout and errors on stderr", () => {
    const schema = run("schema", "trial");
    expect(schema.status).toBe(0);
    expect(JSON.parse(schema.stdout)).toMatchObject({ title: "ichnaea.trial/1" });
    expect(schema.stderr).toBe("");
    const error = run("schema", "unknown");
    expect(error.status).toBe(2);
    expect(error.stdout).toBe("");
    expect(error.stderr).toContain("unknown record 'unknown'");
  });

  it.each(["decide", "report"])("%s puts missing required arguments on stderr", (command) => {
    const result = run(command);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(`${command}: --run is required`);
  });
});

describe("command help", () => {
  it.each(["help", "schema", "doctor", "import", "decide", "report"])(
    "prints %s help and exits 0 without requiring a configuration",
    (command) => {
      const result = run(command, "--help");
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(
        command === "help" ? "Usage: ichnaea <command>" : `Usage: ichnaea ${command}`,
      );
    },
  );

  it("refuses a command that the CLI does not provide", () => {
    const result = run("inspect");
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("unknown command 'inspect'");
  });

  it("shows packaged help when the configuration fails to load", () => {
    const broken = join(cwd, "broken.ts");
    writeFileSync(broken, 'throw new Error("cannot load the configuration");\n');
    const result = run("decide", "--config", broken, "--help");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Where to write the machine-readable verdict");
  });
});
