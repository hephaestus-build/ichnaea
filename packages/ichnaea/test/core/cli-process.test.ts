import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const cwd = mkdtempSync(join(tmpdir(), "ichnaea-cli-"));
const bin = fileURLToPath(new URL("../../src/core/bin.ts", import.meta.url));
const config = join(cwd, "configured.ts");
const entrypoint = new URL("../../src/index.ts", import.meta.url).href;
writeFileSync(
  config,
  `
import { decidePlugin, reportPlugin } from ${JSON.stringify(entrypoint)};
export default { plugins: [decidePlugin(), reportPlugin(), {
  id: "example", version: "1.0.0", stability: "stable",
  commands: [{
    name: "inspect",
    description: "Inspect a synthetic record.",
    options: { label: { type: "string", description: "Label to print." } },
    async run() { throw new Error("help ran the command"); },
  }],
  hooks: { configResolved() { throw new Error("help ran a hook"); } },
}], allowStability: ["alpha"] };
`,
);
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
    const normal = join(cwd, "normal.ts");
    writeFileSync(
      normal,
      `
import { decidePlugin, reportPlugin } from ${JSON.stringify(entrypoint)};
export default { plugins: [decidePlugin(), reportPlugin()], allowStability: ["alpha"] };
`,
    );
    const result = run(command, "--config", normal);
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

  it("shows a configured plugin's command and option descriptions without running it", () => {
    const result = run("inspect", "--config", config, "--help");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Inspect a synthetic record.");
    expect(result.stdout).toContain("--label <value>");
    expect(result.stdout).toContain("Label to print.");
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
