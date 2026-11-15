import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { workspaceZod } from "./consumer-project.ts";
import { decides, readmeExample } from "./readme-example.ts";

const readme = readFileSync(join(import.meta.dirname, "..", "README.md"), "utf8");

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
