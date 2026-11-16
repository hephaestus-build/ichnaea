import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  copiedSources,
  decides,
  importedPackages,
  missingFromInstall,
  PACKAGE_NAME,
  readmeExample,
  readmeInstall,
  RELEASE_SPEC,
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

  it("finds the latest release, downloads and verifies its tarball, and adds it with zod", () => {
    const add = `pnpm add zod@${workspaceZod()} "${RELEASE_SPEC}"`;
    expect(install.commands).toEqual([
      "TAG=$(gh release view -R hephaestus-build/ichnaea --json tagName -q .tagName)",
      `gh release download "$TAG" -R hephaestus-build/ichnaea -p 'hephaestus-build-ichnaea-*.tgz'`,
      'gh attestation verify "hephaestus-build-ichnaea-${TAG#v}.tgz" -R hephaestus-build/ichnaea \\\n' +
        "  --signer-workflow hephaestus-build/ichnaea/.github/workflows/release.yml",
      add,
    ]);
    expect(install.add).toBe(add);
    expect(install.added).toEqual(["zod", PACKAGE_NAME]);
  });

  it("has exactly one pnpm add, the command that the consumer test runs", () => {
    const twice = readme.replace(install.add, `${install.add}\npnpm add left-pad@1.3.0`);
    expect(() => readmeInstall(twice)).toThrow(
      "the install block has 2 pnpm add commands, not one",
    );
  });

  it("adds every package that the copied files of the example import", () => {
    expect(copiedSources(readmeExample(readme))).toEqual(["ichnaea.config.ts", "plugin.ts"]);
    expect(missingFromInstall(readme, exampleFile)).toEqual([]);
  });

  it("fails when its pnpm add leaves out a package that the example imports", () => {
    const broken = readme.replace(` "${RELEASE_SPEC}"`, "");
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

  it("double-quotes the release URL, so that a shell expands its tag and nothing else", () => {
    expect(install.add).toContain(`"${RELEASE_SPEC}"`);
    expect(RELEASE_SPEC).toContain("/releases/download/$TAG/hephaestus-build-ichnaea-${TAG#v}.tgz");
  });
});
