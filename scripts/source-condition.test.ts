// A consumer that links the packages from a checkout runs their TypeScript sources with Node's
// type stripping and no build, by resolving under the `@hephaestus-build/source` condition.
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const root = join(import.meta.dirname, "..");
const CONDITION = "@hephaestus-build/source";

const packages = (await readdir(join(root, "packages"))).toSorted();

describe("the source condition", () => {
  it.each(packages)("%s exports its sources first under the condition", async (name) => {
    const manifest = JSON.parse(
      await readFile(join(root, "packages", name, "package.json"), "utf8"),
    ) as { exports: Record<string, Record<string, string> | string>; files: string[] };
    const main = manifest.exports["."] as Record<string, string>;
    expect(Object.keys(main)[0]).toBe(CONDITION);
    expect(main[CONDITION]).toBe("./src/index.ts");
    expect(manifest.files).toContain("src");
  });

  // A package resolves its own name through its exports (self-reference), so each one loads
  // from its own directory, and its imports of the other packages take the condition too.
  it.each(packages)("%s loads from its sources in plain Node, without a build", async (name) => {
    const id = `@hephaestus-build/ichnaea-${name}`;
    const script = `const url = import.meta.resolve(${JSON.stringify(id)});
      await import(url);
      console.log(url);`;
    const { stdout } = await run(
      process.execPath,
      [`--conditions=${CONDITION}`, "--input-type=module", "-e", script],
      { cwd: join(root, "packages", name) },
    );
    expect(stdout.trim()).toMatch(new RegExp(`/packages/${name}/src/index\\.ts$`));
  });
});
