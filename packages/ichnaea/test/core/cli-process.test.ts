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
  it.each(["help", "schema", "doctor", "import", "plan", "decide", "report"])(
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

describe("structured CLI output", () => {
  it.each([
    ["decide", "--run", "first", "--run", "second"],
    ["report", "--run", "first", "--format", "nonsense"],
    ["doctor", "--unknown"],
    ["schema", "trial", "extra"],
  ])("refuses invalid grammar (%s)", (...argv) => {
    const result = run(...argv, "--json");
    expect(result.status).toBe(2);
    const error = JSON.parse(result.stdout);
    expect(error).toMatchObject({ schema: "ichnaea.cli.error/1", code: "USAGE" });
    expect(JSON.parse(result.stderr)).toEqual(error);
  });

  it("keeps diagnostics separate when a configuration logs and throws", () => {
    const noisy = join(cwd, "noisy.ts");
    writeFileSync(
      noisy,
      'console.log("loading"); process.stdout.write("still loading"); throw new Error("private-config-sentinel");\n',
    );
    const result = run("doctor", "--config", noisy, "--json");
    expect(result.status).toBe(2);
    const error = JSON.parse(result.stdout);
    expect(error).toMatchObject({ schema: "ichnaea.cli.error/1", code: "CONFIGURATION" });
    expect(result.stdout + result.stderr).not.toContain("private-config-sentinel");
    const lines = result.stderr.trimEnd().split("\n");
    expect(lines).toContain("[plugin] loading");
    expect(lines).toContain("[plugin] still loading");
    expect(JSON.parse(lines.at(-1) ?? "")).toEqual(error);
  });

  it("shows the registry as one help document", () => {
    const result = run("report", "--help", "--json");
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: "ichnaea.help/1",
      commands: [
        {
          name: "report",
          options: expect.arrayContaining([
            expect.objectContaining({ name: "format", choices: ["md", "html", "json"] }),
          ]),
        },
      ],
    });
  });
});

it("names the store path in a structured missing-record error", () => {
  const result = run("decide", "--run", "missing+candidate", "--json");
  expect(result.status).toBe(2);
  const document = JSON.parse(result.stdout);
  expect(document).toMatchObject({
    schema: "ichnaea.cli.error/1",
    code: "RECORDS",
    message: expect.stringContaining(join(".ichnaea", "runs", "missing%2Bcandidate")),
  });
  expect(JSON.parse(result.stderr)).toEqual(document);
});
