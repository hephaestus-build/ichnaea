import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  copiedSources,
  decides,
  importedPackages,
  missingFromInstall,
  readmeExample,
  readmeInstall,
  workspaceZod,
} from "./readme-example.ts";

const readme = readFileSync(join(import.meta.dirname, "..", "README.md"), "utf8");
const exampleFile = (file: string): string =>
  readFileSync(join(import.meta.dirname, "..", "examples", "support-assistant", file), "utf8");

describe("the README's five-minute example", () => {
  const example = readmeExample(readme);

  it("states an unchanged and a regressed candidate, each with an import and a decide", () => {
    expect(example.scenarios.map((s) => [s.scenario, s.results, s.run])).toEqual([
      ["An unchanged candidate", "results/candidate-same.json", "unchanged"],
      ["A regressed candidate", "results/candidate-regressed.json", "regressed"],
    ]);
    for (const s of example.scenarios)
      expect(example.commands.filter((c) => decides(c, s.run))).toHaveLength(1);
  });

  it("keeps a command's continuation lines and drops comments", () => {
    const imports = example.commands.filter((c) => c.includes(" import "));
    expect(imports).toHaveLength(2);
    expect(imports[0]).toContain("\\\n  --suite data/suite.json");
    expect(example.commands.some((c) => c.startsWith("#"))).toBe(false);
  });

  it("installs the zod version that the workspace builds and tests with", () => {
    expect([...readme.matchAll(/zod@(\S+)/g)].map((m) => m[1])).toEqual([workspaceZod()]);
  });

  it("fails when a scenario's results file has no import command", () => {
    const broken = readme.replace(
      "--file results/candidate-same.json",
      "--file results/other.json",
    );
    expect(() => readmeExample(broken)).toThrow("no import command of the example reads");
  });
});

describe("the README's install", () => {
  const install = readmeInstall(readme);

  it("links the submodule's packages and adds zod and the packages that the example imports", () => {
    expect(install.commands[0]).toBe("pnpm pkg set type=module");
    expect(install.added).toEqual(["zod", "@hephaestus-build/ichnaea"]);
    expect(install.workspace).toBe("packages:\n  - vendor/ichnaea/packages/*\n");
  });

  it("adds every package that the copied files of the example import", () => {
    expect(copiedSources(readmeExample(readme))).toEqual(["ichnaea.config.ts", "plugin.ts"]);
    expect(missingFromInstall(readme, exampleFile)).toEqual([]);
  });

  it("fails when its pnpm add leaves out a package that the example imports", () => {
    const broken = readme.replace(` '@hephaestus-build/ichnaea@workspace:*'`, "");
    expect(broken).not.toBe(readme);
    expect(missingFromInstall(broken, exampleFile)).toEqual([
      "ichnaea.config.ts imports @hephaestus-build/ichnaea, which the README's pnpm add leaves out",
      "plugin.ts imports @hephaestus-build/ichnaea, which the README's pnpm add leaves out",
    ]);
  });

  it("reads the packages that a file imports by name, not node: or relative imports", () => {
    const source = `import { a } from "node:fs";\nimport type { B } from "@scope/b/sub";\nimport "c";\nimport { d } from "./d.ts";`;
    expect(importedPackages(source)).toEqual(["@scope/b", "c"]);
  });

  it("quotes each workspace protocol, so that zsh does not read its * as a glob", () => {
    const specifiers = install.commands.join(" ").match(/\S*@workspace:\*\S*/g) ?? [];
    expect(specifiers).toHaveLength(1);
    for (const specifier of specifiers) expect(specifier).toMatch(/^'.*'$/);
  });
});
