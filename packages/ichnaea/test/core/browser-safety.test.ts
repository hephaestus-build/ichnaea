// The pure modules run in a browser: the static import closure of the record contracts, the
// statistics, compare and report holds no Node built-in, no package but
// zod, no dynamic import of a computed specifier, and no Node-only global.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { browserProblems, codeOnly } from "./support/browser-closure.ts";

const src = join(import.meta.dirname, "..", "..", "src");
const ENTRIES = [
  "contracts/index.ts",
  "stats/index.ts",
  "decide/compare.ts",
  "report/report.ts",
].map((f) => join(src, f));

describe("the pure modules", () => {
  it("import nothing a browser lacks, through their whole static closure", () => {
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
    for (const node of ["core/store.ts", "core/import.ts", "core/cli.ts", "core/version.ts"])
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
    ["global", "export const g = global.x;", "the Node-only global 'global'"],
    ["setImmediate", "setImmediate(() => undefined);", "the Node-only global 'setImmediate'"],
    [
      "import.meta.dirname",
      "export const d = import.meta.dirname;",
      "the Node-only import.meta.dirname",
    ],
    [
      "import.meta.filename",
      "export const f = import.meta.filename;",
      "the Node-only import.meta.filename",
    ],
    [
      "import.meta.resolve",
      'export const r = import.meta.resolve("x");',
      "the Node-only import.meta.resolve",
    ],
    ["a computed dynamic import", "export const m = import(name);", "a dynamic import of name"],
    ["Date.now", "export const t = Date.now();", "a read of the clock: Date.now("],
    [
      "a new Date with no argument",
      "export const d = new Date();",
      "a read of the clock: new Date()",
    ],
    [
      "a new Date with no parentheses",
      "export const d = new Date;",
      "a read of the clock: new Date",
    ],
    [
      "performance.now",
      "export const t = performance.now();",
      "a read of the clock: performance.now(",
    ],
    ["Math.random", "export const r = Math.random();", "a random draw: Math.random("],
    [
      "getRandomValues",
      "export const b = crypto.getRandomValues(new Uint8Array(4));",
      "a random draw: getRandomValues(",
    ],
    ["randomUUID", "export const id = crypto.randomUUID();", "a random draw: randomUUID("],
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

  it("allows a Date from a value and a parsed time, which read no clock", () => {
    const text =
      'export const d = new Date("2026-11-16T00:00:00Z");\nexport const t = Date.parse(x);\n';
    expect(browserProblems([entry("dates.ts", text)]).problems).toEqual([]);
  });

  it("skips a regular expression literal, so a quote or a brace in it hides no code", () => {
    // A quote in the literal would otherwise open a string that blanks the rest of the line.
    const quote = 'const r = /"/; export const v = process.version;\n';
    expect(browserProblems([entry("regex-quote.ts", quote)]).problems).toEqual([
      {
        file: expect.stringMatching(/regex-quote\.ts$/),
        problem: "the Node-only global 'process'",
      },
    ]);
    // Braces in a literal inside a template expression would otherwise end the expression early.
    const braces =
      'export const t = `${ids.map((id) => id.replaceAll(/[.*+?^${}()|[\\]\\\\]/g, "x")).join("|")}`;\nexport const v = process.version;\n';
    expect(browserProblems([entry("regex-braces.ts", braces)]).problems).toEqual([
      {
        file: expect.stringMatching(/regex-braces\.ts$/),
        problem: "the Node-only global 'process'",
      },
    ]);
    expect(codeOnly('const r = /a"b/g;')).toBe("const r = /   /g;");
    expect(codeOnly("x = a / b / c;")).toBe("x = a / b / c;");
    expect(codeOnly("return /x/.test(s) ? 1 : 0;")).toBe("return / /.test(s) ? 1 : 0;");
  });

  it("refuses a module it cannot read: brackets that do not balance once text is blanked", () => {
    expect(browserProblems([entry("unbalanced.ts", "export const x = f(1;\n")]).problems).toEqual([
      {
        file: expect.stringMatching(/unbalanced\.ts$/),
        problem:
          "brackets that do not balance once comments, strings and regular expressions are blanked",
      },
    ]);
  });

  it("does not read comments or the text of strings as code", () => {
    const text =
      '// process.exit() in a comment\n/** require("fs") */\nexport const a = "process";\nexport const b = `Buffer ${1 + 1} __dirname`;\n';
    expect(browserProblems([entry("words.ts", text)]).problems).toEqual([]);
    expect(codeOnly("const t = `a ${x} b`;")).toBe("const t = `  ${x}  `;");
  });
});
