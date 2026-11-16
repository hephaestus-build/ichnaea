// The library API runs in a browser: the static import closure of the modules that define
// defineSuite, binary, createPlan, importResults, compare and report holds no Node built-in, no
// package but zod, no dynamic import of a computed specifier, and no Node-only global.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { browserProblems, codeOnly } from "./support/browser-closure.ts";

const src = join(import.meta.dirname, "..", "..", "src");
const ENTRIES = [
  "core/suite.ts",
  "decide/plan.ts",
  "core/results.ts",
  "decide/compare.ts",
  "report/report.ts",
].map((f) => join(src, f));

describe("the browser-safe library API", () => {
  it("imports nothing a browser lacks, through its whole static closure", () => {
    const { files, problems } = browserProblems(ENTRIES);
    expect(problems).toEqual([]);
    // The walk reached the decision rule, the statistics and the contracts.
    const relative = files.map((f) => f.slice(f.indexOf("/src/") + 5));
    expect(relative).toEqual(
      expect.arrayContaining([
        "decide/decide.ts",
        "stats/compare.ts",
        "contracts/sha256.ts",
        "report/render.ts",
      ]),
    );
    // The Node-only modules stay outside it.
    for (const node of ["core/cases.ts", "core/store.ts", "core/import.ts", "core/cli.ts"])
      expect(relative).not.toContain(node);
  });
});

describe("the check", () => {
  const dir = mkdtempSync(join(tmpdir(), "ichnaea-browser-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const entry = (name: string, text: string): string => {
    const path = join(dir, name);
    writeFileSync(path, text);
    return path;
  };

  it.each([
    ["a node: specifier", 'import { readFile } from "node:fs";', "the Node built-in 'node:fs'"],
    ["a bare built-in", 'import path from "path";', "the Node built-in 'path'"],
    [
      "a bare built-in subpath",
      'import { x } from "fs/promises";',
      "the Node built-in 'fs/promises'",
    ],
    ["another package", 'export { x } from "lodash";', "the package 'lodash', which is not zod"],
    ["a side-effect import", 'import "crypto";', "the Node built-in 'crypto'"],
    ["process", "export const v = process.version;", "the Node-only global 'process'"],
    ["Buffer", 'export const b = Buffer.from("a");', "the Node-only global 'Buffer'"],
    ["__dirname", "export const d = __dirname;", "the Node-only global '__dirname'"],
    ["require", 'export const r = require("x");', "the Node-only global 'require'"],
    [
      "globalThis.process",
      "export const p = globalThis.process;",
      "the Node-only global 'process'",
    ],
    ["a computed dynamic import", "export const m = import(name);", "a dynamic import of name"],
    [
      "a dynamic import in a local module",
      'export const m = import("./other.ts" + suffix);',
      'a dynamic import of "./other.ts" + suffix',
    ],
  ])("fails on %s", (name, text, problem) => {
    const file = entry(`${name.replaceAll(/\W/g, "-")}.ts`, `${text}\n`);
    expect(browserProblems([file]).problems.map((p) => p.problem)).toEqual([problem]);
  });

  it("follows local imports, a literal dynamic import among them, and accepts zod", () => {
    entry("leaf.ts", 'import { readFileSync } from "node:fs";\n');
    const file = entry(
      "root.ts",
      'import * as z from "zod";\nexport const m = import("./leaf.ts");\nexport const s = z.string();\n',
    );
    expect(browserProblems([file]).problems).toEqual([
      { file: expect.stringMatching(/leaf\.ts$/), problem: "the Node built-in 'node:fs'" },
    ]);
  });

  it("does not read comments or the text of strings as code", () => {
    const text =
      '// process.exit() in a comment\n/** require("fs") */\nexport const a = "process";\nexport const b = `Buffer ${1 + 1} __dirname`;\n';
    expect(browserProblems([entry("words.ts", text)]).problems).toEqual([]);
    expect(codeOnly("const t = `a ${x} b`;")).toBe("const t = `  ${x}  `;");
  });
});
