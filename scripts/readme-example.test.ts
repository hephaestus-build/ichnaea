import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AUDIT,
  copiedSources,
  decides,
  importedPackages,
  installCommands,
  missingFromInstall,
  PACKAGE_NAME,
  readmeExample,
  readmeInstall,
  workspaceZod,
} from "./readme-example.ts";

const readme = readFileSync(join(import.meta.dirname, "..", "README.md"), "utf8");
const exampleFile = (file: string): string =>
  readFileSync(join(import.meta.dirname, "..", "examples", "support-assistant", file), "utf8");

describe("the README's five-minute example", () => {
  const example = readmeExample(readme);

  it("states an unchanged candidate and one with lower observed rates, each with an import and a decide", () => {
    expect(example.scenarios.map((s) => [s.scenario, s.results, s.run])).toEqual([
      ["An unchanged candidate", "results/candidate-same.json", "unchanged"],
      ["A candidate with lower observed rates", "results/candidate-regressed.json", "regressed"],
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

  it("installs the zod version that the workspace builds and tests with, wherever it adds zod", () => {
    const versions = [...readme.matchAll(/zod@(\S+)/g)].map((m) => m[1]);
    expect(versions.length).toBeGreaterThan(0);
    expect(new Set(versions)).toEqual(new Set([workspaceZod()]));
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

  it("adds the package from npm with the tested zod, then checks the signatures and provenance", () => {
    const add = `pnpm add ${PACKAGE_NAME} zod@${workspaceZod()}`;
    expect(install.commands).toEqual(["pnpm pkg set type=module", add, AUDIT]);
    expect(install.add).toBe(add);
    expect(install.added).toEqual([PACKAGE_NAME, "zod"]);
  });

  it("has exactly one pnpm add, and checks the signatures after it", () => {
    const twice = readme.replace(install.add, `${install.add}\npnpm add left-pad@1.3.0`);
    expect(() => readmeInstall(twice)).toThrow(
      "the install block has 2 pnpm add commands, not one",
    );
    const before = readme.replace(`${install.add}\n${AUDIT}`, `${AUDIT}\n${install.add}`);
    expect(before).not.toBe(readme);
    expect(() => readmeInstall(before)).toThrow(
      `the install block does not run ${AUDIT} after its pnpm add`,
    );
  });

  it("runs, in the consumer test, the package's tarball in place of its name, then the audit", () => {
    expect(installCommands(install, "file:/tmp/tumaet-ichnaea-0.0.0.tgz")).toEqual([
      "pnpm pkg set type=module",
      `pnpm add 'file:/tmp/tumaet-ichnaea-0.0.0.tgz' zod@${workspaceZod()}`,
      AUDIT,
    ]);
  });

  it("is the install block of the documentation site's install page, byte for byte", () => {
    const page = readFileSync(
      join(
        import.meta.dirname,
        "..",
        "docs",
        "site",
        "src",
        "content",
        "docs",
        "how-to",
        "install.mdx",
      ),
      "utf8",
    );
    expect(page).toContain(`\`\`\`sh\n${install.commands.join("\n")}\n\`\`\``);
    expect(page).not.toContain("not on npm before 1.0");
  });

  it("adds every package that the copied files of the example import", () => {
    expect(copiedSources(readmeExample(readme))).toEqual(["ichnaea.config.ts", "plugin.ts"]);
    expect(missingFromInstall(readme, exampleFile)).toEqual([]);
  });

  it("fails when its pnpm add leaves out a package that the example imports", () => {
    const broken = readme.replace(`pnpm add ${PACKAGE_NAME} `, "pnpm add ");
    expect(broken).not.toBe(readme);
    expect(missingFromInstall(broken, exampleFile)).toEqual([
      "ichnaea.config.ts imports @tumaet/ichnaea, which the README's pnpm add leaves out",
      "plugin.ts imports @tumaet/ichnaea, which the README's pnpm add leaves out",
    ]);
  });

  it("reads the packages that a file imports by name, not node: or relative imports", () => {
    const source = `import { a } from "node:fs";\nimport type { B } from "@scope/b/sub";\nimport "c";\nimport { d } from "./d.ts";`;
    expect(importedPackages(source)).toEqual(["@scope/b", "c"]);
  });
});
