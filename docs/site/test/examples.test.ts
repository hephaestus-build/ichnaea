import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Each example that a page shows is a file under docs/site/examples, and runs here as the page says.
const repository = join(import.meta.dirname, "..", "..", "..");
const run = (file: string, cwd: string): string =>
  execFileSync(
    process.execPath,
    ["--conditions=ichnaea-source", join(import.meta.dirname, "..", "examples", file)],
    {
      cwd: join(repository, cwd),
      encoding: "utf8",
    },
  );

describe("docs examples", () => {
  it("privacy: export-case.ts drops the content of a personal case", () => {
    const output = run("privacy/export-case.ts", "examples/support-assistant");
    expect(output).toContain("[ '/input', '/references' ]");
    expect(output).toContain("dataClass, family, id, pool, provenance, schema, unit");
  });
});
